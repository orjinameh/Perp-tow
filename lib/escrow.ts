import { createPublicClient, createWalletClient, encodeAbiParameters, http, keccak256, parseAbi, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';

type Hex = `0x${string}`;
export const RPC = 'https://api.hideki2.infra.testnet.somnia.network';
export const USDSO = '0xed7993A74dAe1e6656B704A424DcD8711aAf4F72' as const;

/** Empty means the escrow is off: the app computes results only and moves no money. */
export const ESCROW_ADDRESS = (process.env.NEXT_PUBLIC_ESCROW_ADDRESS || '') as Hex | '';
export const escrowEnabled = ESCROW_ADDRESS !== '';

export const ESCROW_ABI = parseAbi([
  'function join(bytes32 key, uint8 side)',
  'function claim(bytes32 key)',
  'function leave(bytes32 key)',
  'function start(bytes32 key)',
  'function settle(bytes32 key, uint8 result)',
  'function matches(bytes32) view returns (uint32 bulls, uint32 bears, uint64 startedAt, uint8 result, uint256 rakeOwed)',
  'function sideOf(bytes32, address) view returns (uint8)',
  'function claimed(bytes32, address) view returns (bool)',
  'function joinFor(address player, address pool, bytes32 key, uint8 side)',
  'function claimFor(address player, address pool, bytes32 key)',
  'function leaveFor(address player, address pool, bytes32 key)',
  'function setBot(address bot, bool allowed)',
  'function duration() view returns (uint64)',
  'function graceAfter() view returns (uint64)',
]);
const ERC20 = parseAbi(['function approve(address,uint256) returns (bool)', 'function allowance(address,address) view returns (uint256)', 'function balanceOf(address) view returns (uint256)']);

/** True when the key signs for a different account (the game wallet acting as a bot for a main wallet). */
const forOther = (key: Hex, address: Hex) => privateKeyToAccount(key).address.toLowerCase() !== address.toLowerCase();

/** Same key the contract computes: keccak256(abi.encode(market, number)). */
export function matchKey(ticker: string, matchNumber: number): Hex {
  return keccak256(encodeAbiParameters([{ type: 'string' }, { type: 'uint256' }], [ticker, BigInt(matchNumber)]));
}

const pub = () => createPublicClient({ chain: hidekiTestnet, transport: http(RPC) });
const wallet = (key: Hex) => createWalletClient({ chain: hidekiTestnet, transport: http(RPC), account: privateKeyToAccount(key) });

async function send(key: Hex, address: Hex, abi: unknown, functionName: string, args: unknown[], to: Hex) {
  const hash = await wallet(key).writeContract({ address: to, abi: abi as never, functionName: functionName as never, args: args as never });
  const rc = await pub().waitForTransactionReceipt({ hash });
  if (rc.status !== 'success') throw new Error(`${functionName} reverted on chain (${hash}).`);
  return hash;
}

/** Approves the stake if needed, then deposits it on a side. Always the player's own wallet. */
export async function joinEscrow(key: Hex, address: Hex, ticker: string, matchNumber: number, side: 'bulls' | 'bears', stakeUsd: number) {
  if (!escrowEnabled) return null;
  const stake = parseUnits(String(stakeUsd), 18);
  const allowance = await pub().readContract({ address: USDSO, abi: ERC20, functionName: 'allowance', args: [address, ESCROW_ADDRESS as Hex] });
  if (forOther(key, address)) {
    // The bot pays the stake from its own USDso. The seat, refund and payout belong to the main wallet.
    const bot = privateKeyToAccount(key).address;
    const have = (await pub().readContract({ address: USDSO, abi: ERC20, functionName: 'balanceOf', args: [bot] })) as bigint;
    if (have < stake) throw new Error('The game wallet needs at least $10 of USDso to stake. Send it from your main wallet.');
    const botAllowance = await pub().readContract({ address: USDSO, abi: ERC20, functionName: 'allowance', args: [bot, ESCROW_ADDRESS as Hex] });
    if (botAllowance < stake) await send(key, bot, ERC20, 'approve', [ESCROW_ADDRESS, stake * 100n], USDSO);
    const pool = await (await import('./pools')).poolOf(ticker);
    return send(key, address, ESCROW_ABI, 'joinFor', [address, pool, matchKey(ticker, matchNumber), side === 'bulls' ? 1 : 2], ESCROW_ADDRESS as Hex);
  }
  if (allowance < stake) await send(key, address, ERC20, 'approve', [ESCROW_ADDRESS, stake], USDSO);
  return send(key, address, ESCROW_ABI, 'join', [matchKey(ticker, matchNumber), side === 'bulls' ? 1 : 2], ESCROW_ADDRESS as Hex);
}

export async function claimEscrow(key: Hex, address: Hex, ticker: string, matchNumber: number) {
  if (!escrowEnabled) throw new Error('The escrow is not switched on.');
  if (forOther(key, address)) return send(key, address, ESCROW_ABI, 'claimFor', [address, await (await import('./pools')).poolOf(ticker), matchKey(ticker, matchNumber)], ESCROW_ADDRESS as Hex);
  return send(key, address, ESCROW_ABI, 'claim', [matchKey(ticker, matchNumber)], ESCROW_ADDRESS as Hex);
}

/** What the escrow says about this match and this player. */
export async function escrowStatus(ticker: string, matchNumber: number, player: Hex) {
  if (!escrowEnabled) return null;
  const key = matchKey(ticker, matchNumber);
  const [m, side, done, dur, grace] = await Promise.all([
    pub().readContract({ address: ESCROW_ADDRESS as Hex, abi: ESCROW_ABI, functionName: 'matches', args: [key] }),
    pub().readContract({ address: ESCROW_ADDRESS as Hex, abi: ESCROW_ABI, functionName: 'sideOf', args: [key, player] }),
    pub().readContract({ address: ESCROW_ADDRESS as Hex, abi: ESCROW_ABI, functionName: 'claimed', args: [key, player] }),
    pub().readContract({ address: ESCROW_ADDRESS as Hex, abi: ESCROW_ABI, functionName: 'duration' }),
    pub().readContract({ address: ESCROW_ADDRESS as Hex, abi: ESCROW_ABI, functionName: 'graceAfter' }),
  ]);
  const startedAt = Number(m[2]);
  const result = Number(m[3]);
  // The contract opens refunds for a match the operator never settled once this much time has passed.
  const refundOpen = result === 3 || (result === 0 && startedAt !== 0 && (await import('./clock')).nowSec() >= startedAt + Number(dur) + Number(grace));
  return { bulls: Number(m[0]), bears: Number(m[1]), result, joined: side !== 0, claimed: done, startedAt, refundOpen };
}

/** Takes the stake back from a match that has not started. */
export async function leaveEscrow(key: Hex, address: Hex, ticker: string, matchNumber: number) {
  if (!escrowEnabled) throw new Error('The escrow is not switched on.');
  if (forOther(key, address)) return send(key, address, ESCROW_ABI, 'leaveFor', [address, await (await import('./pools')).poolOf(ticker), matchKey(ticker, matchNumber)], ESCROW_ADDRESS as Hex);
  return send(key, address, ESCROW_ABI, 'leave', [matchKey(ticker, matchNumber)], ESCROW_ADDRESS as Hex);
}
