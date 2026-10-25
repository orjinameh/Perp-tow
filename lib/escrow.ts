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
  'function settle(bytes32 key, uint8 result)',
  'function matches(bytes32) view returns (uint32 bulls, uint32 bears, uint64 startedAt, uint8 result, uint256 rakeOwed)',
  'function sideOf(bytes32, address) view returns (uint8)',
  'function claimed(bytes32, address) view returns (bool)',
]);
const ERC20 = parseAbi(['function approve(address,uint256) returns (bool)', 'function allowance(address,address) view returns (uint256)']);

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
  if (allowance < stake) await send(key, address, ERC20, 'approve', [ESCROW_ADDRESS, stake], USDSO);
  return send(key, address, ESCROW_ABI, 'join', [matchKey(ticker, matchNumber), side === 'bulls' ? 1 : 2], ESCROW_ADDRESS as Hex);
}

export async function claimEscrow(key: Hex, address: Hex, ticker: string, matchNumber: number) {
  if (!escrowEnabled) throw new Error('The escrow is not switched on.');
  return send(key, address, ESCROW_ABI, 'claim', [matchKey(ticker, matchNumber)], ESCROW_ADDRESS as Hex);
}

/** What the escrow says about this match and this player. */
export async function escrowStatus(ticker: string, matchNumber: number, player: Hex) {
  if (!escrowEnabled) return null;
  const key = matchKey(ticker, matchNumber);
  const [m, side, done] = await Promise.all([
    pub().readContract({ address: ESCROW_ADDRESS as Hex, abi: ESCROW_ABI, functionName: 'matches', args: [key] }),
    pub().readContract({ address: ESCROW_ADDRESS as Hex, abi: ESCROW_ABI, functionName: 'sideOf', args: [key, player] }),
    pub().readContract({ address: ESCROW_ADDRESS as Hex, abi: ESCROW_ABI, functionName: 'claimed', args: [key, player] }),
  ]);
  return { bulls: Number(m[0]), bears: Number(m[1]), result: Number(m[3]), joined: side !== 0, claimed: done };
}
