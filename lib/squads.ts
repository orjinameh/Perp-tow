import { createPublicClient, createWalletClient, encodeAbiParameters, http, keccak256, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { nowSec } from './clock';

type Hex = `0x${string}`;
const RPC = 'https://api.hideki2.infra.testnet.somnia.network';
const USDSO = '0xed7993A74dAe1e6656B704A424DcD8711aAf4F72' as const;

/** The squads contract: seats, stakes, random balanced teams and payouts. Set after `npm run deploy:squads`. */
export const SQUADS_ADDRESS = (process.env.NEXT_PUBLIC_SQUADS_ADDRESS || '') as Hex | '';
export const squadsEnabled = SQUADS_ADDRESS !== '';

const ABI = parseAbi([
  'function enter(string market, uint256 number, uint32 wantedSize)',
  'function enterFor(address player, address pool, string market, uint256 number, uint32 wantedSize)',
  'function leave(string market, uint256 number)',
  'function leaveFor(address player, address pool, string market, uint256 number)',
  'function confirm(string market, uint256 number)',
  'function confirmFor(address player, address pool, string market, uint256 number)',
  'function finish(string market, uint256 number)',
  'function claim(bytes32 key, address player)',
  'function claimFor(address player, address pool, bytes32 key)',
  'function settle(bytes32 key)',
  'function teamScores(bytes32 key) view returns (int256 bulls, int256 bears)',
  'function scoreOf(bytes32 key, address player) view returns (int256)',
  'function latestMatch(string market) view returns (uint256)',
  'function roster(string market, uint256 number) view returns (address[] players, bool[] confirmed, uint8[] teams, uint64 firstAt, uint64 lockAt, bool cancelled, uint8 result, uint32 cap)',
  'function matches(bytes32) view returns (uint64 firstAt, uint64 lockAt, bytes32 seed, uint8 result, bool cancelled, uint256 rakeOwed, uint32 cap)',
  'function claimed(bytes32, address) view returns (bool)',
  'function size() view returns (uint32)',
  'function minPlayers() view returns (uint32)',
  'function lobbySeconds() view returns (uint64)',
  'function confirmSeconds() view returns (uint64)',
  'function duration() view returns (uint64)',
  'function graceAfter() view returns (uint64)',
  'function stake() view returns (uint256)',
  'function bankroll() view returns (uint256)',
  'function vaultOf(bytes32, address) view returns (address)',
  'function release(bytes32 key, address player)',
  'function rakeBps() view returns (uint16)',
]);
const ERC20 = parseAbi(['function approve(address,uint256) returns (bool)', 'function allowance(address,address) view returns (uint256)', 'function balanceOf(address) view returns (uint256)']);

const pub = () => createPublicClient({ chain: hidekiTestnet, transport: http(RPC) });
const read = <T,>(functionName: string, args: unknown[] = []) =>
  pub().readContract({ address: SQUADS_ADDRESS as Hex, abi: ABI, functionName: functionName as never, args: args as never }) as Promise<T>;

export const squadKey = (ticker: string, number: number): Hex => keccak256(encodeAbiParameters([{ type: 'string' }, { type: 'uint256' }], [ticker, BigInt(number)]));

export interface SquadParams {
  size: number; // the most seats a match may have
  minPlayers: number;
  lobbySeconds: number;
  confirmSeconds: number;
  duration: number; // seconds from the lock to the end of the match
  graceAfter: number;
  stakeUsd: number;
  bankrollUsd: number; // equal trading bankroll each player gets in their own vault
  rake: number; // 0.2 = 20%
}

let paramsCache: SquadParams | null = null;
/** The rules exactly as the contract was deployed, so the app can never drift from them. */
export async function readSquadParams(): Promise<SquadParams> {
  if (paramsCache) return paramsCache;
  const bankrollRaw = await read<bigint>('bankroll');
  const [size, minPlayers, lobbySeconds, confirmSeconds, duration, graceAfter, stake, rakeBps] = await Promise.all([
    read<number>('size'), read<number>('minPlayers'), read<bigint>('lobbySeconds'), read<bigint>('confirmSeconds'),
    read<bigint>('duration'), read<bigint>('graceAfter'), read<bigint>('stake'), read<number>('rakeBps'),
  ]);
  paramsCache = {
    size: Number(size), minPlayers: Number(minPlayers), lobbySeconds: Number(lobbySeconds), confirmSeconds: Number(confirmSeconds),
    duration: Number(duration), graceAfter: Number(graceAfter), stakeUsd: Number(stake / 10n ** 12n) / 1e6, bankrollUsd: Number(bankrollRaw / 10n ** 12n) / 1e6, rake: Number(rakeBps) / 10_000,
  };
  return paramsCache;
}

export type SquadPhase = 'filling' | 'confirming' | 'finishable' | 'trading' | 'ended' | 'settled' | 'cancelled';

export interface SquadMatch {
  id: string; // "BTC #3"
  ticker: string;
  number: number;
  size: number; // seats in this match, chosen by its host
  players: { address: string; confirmed: boolean; team: 0 | 1 | 2 }[];
  phase: SquadPhase;
  firstAt: number;
  lockAt: number; // 0 until the match locks
  endsAt: number; // lockAt + duration, 0 until locked
  lobbyEndsAt: number;
  confirmEndsAt: number;
  result: 0 | 1 | 2 | 3; // 0 pending, 1 Bulls, 2 Bears, 3 refund
  bulls: number;
  bears: number;
}

export const TEAM_NAME = { 1: 'Bulls', 2: 'Bears' } as const;

/** The newest matches on one market, straight from the contract. Phases come from its own timestamps and settings. */
export async function loadSquadMatches(ticker: string, window = 20): Promise<SquadMatch[]> {
  if (!squadsEnabled) throw new Error('The squads contract is not set up yet (NEXT_PUBLIC_SQUADS_ADDRESS is empty). Run `npm run deploy:squads`.');
  const p = await readSquadParams();
  const latest = Number(await read<bigint>('latestMatch', [ticker]));
  const nums: number[] = [];
  for (let n = Math.max(1, latest - window + 1); n <= latest; n++) nums.push(n);
  const now = nowSec();
  const rows = await Promise.all(
    nums.map(async (number) => {
      const [players, confirmed, teams, firstAt, lockAt, cancelled, result, cap] = await read<readonly [readonly Hex[], readonly boolean[], readonly number[], bigint, bigint, boolean, number, number]>('roster', [ticker, BigInt(number)]);
      const first = Number(firstAt);
      const lock = Number(lockAt);
      const lobbyEndsAt = first ? first + p.lobbySeconds : 0;
      const confirmEndsAt = lobbyEndsAt ? lobbyEndsAt + p.confirmSeconds : 0;
      const endsAt = lock ? lock + p.duration : 0;
      let phase: SquadPhase;
      if (cancelled) phase = 'cancelled';
      else if (lock) phase = result !== 0 ? 'settled' : now < endsAt ? 'trading' : 'ended';
      else if (now < lobbyEndsAt) phase = 'filling';
      else if (now < confirmEndsAt) phase = 'confirming';
      else phase = 'finishable'; // anyone can finish it
      const list = players.map((a, i) => ({ address: a as string, confirmed: confirmed[i], team: Number(teams[i]) as 0 | 1 | 2 }));
      return {
        id: `${ticker} #${number}`, ticker, number, size: Number(cap), players: list, phase, firstAt: first, lockAt: lock, endsAt, lobbyEndsAt, confirmEndsAt,
        result: Number(result) as SquadMatch['result'], bulls: list.filter((x) => x.team === 1).length, bears: list.filter((x) => x.team === 2).length,
      } satisfies SquadMatch;
    }),
  );
  return rows.filter((r) => r.players.length > 0).sort((a, b) => b.number - a.number);
}

/** The number a brand-new match on this market should take: one past the newest on the chain. */
export async function nextSquadNumber(ticker: string): Promise<number> {
  return Number(await read<bigint>('latestMatch', [ticker])) + 1;
}

// ------------------------------------------------------------------ writes

const walletFor = (key: Hex) => createWalletClient({ chain: hidekiTestnet, transport: http(RPC), account: privateKeyToAccount(key) });
const forOther = (key: Hex, player?: Hex) => !!player && player.toLowerCase() !== privateKeyToAccount(key).address.toLowerCase();

function friendly(e: unknown): Error {
  const err = e as { shortMessage?: string; message?: string };
  const text = (err.shortMessage ?? err.message ?? String(e)).replace(/\s+/g, ' ');
  if (/not allowed/i.test(text)) return new Error('This game wallet is not added as a bot for your main wallet yet. Add it in the dreamDEX app ("Add bot", Perps ticked) and try again.');
  if (/lobby is closed/i.test(text)) return new Error('This lobby has closed. Open or join a newer match.');
  if (/bad match size/i.test(text)) return new Error('That match size is not allowed. Pick between 2 and the maximum.');
  if (/match is full/i.test(text)) return new Error('This match is already full. Open a new match.');
  if (/cannot rejoin|you left this match/i.test(text)) return new Error('You left this match, so you cannot take a seat in it again. Join or open a different match.');
  if (/already in/i.test(text)) return new Error('This wallet already has a seat in this match.');
  if (/match number too high/i.test(text)) return new Error('That match number is not next in line. Reload and try again.');
  if (/lobby still open/i.test(text)) return new Error('The lobby is still open on the chain. Wait a few seconds and try again.');
  if (/confirm window closed/i.test(text)) return new Error('The confirm window has closed.');
  if (/not in this match/i.test(text)) return new Error('This wallet has no seat in this match.');
  if (/transfer|allowance|exceeds balance/i.test(text)) return new Error('Not enough USDso for the stake plus the trading bankroll (or the approval did not go through). Check the wallet that pays.');
  if (/lost/.test(text)) return new Error('Your team lost this match, so there is nothing to claim.');
  if (/not settled/i.test(text)) return new Error('The result has not been settled yet. Press Settle once the match is over.');
  return new Error(text.slice(0, 280));
}

async function send(key: Hex, fn: string, args: unknown[]) {
  const wallet = walletFor(key);
  let hash: Hex;
  try {
    hash = await wallet.writeContract({ address: SQUADS_ADDRESS as Hex, abi: ABI, functionName: fn as never, args: args as never });
  } catch (e) {
    throw friendly(e);
  }
  const rc = await pub().waitForTransactionReceipt({ hash });
  if (rc.status !== 'success') throw new Error(`${fn} reverted on chain (${hash}).`);
  return hash;
}

/** Takes a seat and stakes. With `player` set, the game wallet acts as that account's bot and pays the stake itself. */
export async function enterSquad(key: Hex, ticker: string, number: number, player?: Hex, size = 0): Promise<string> {
  if (!squadsEnabled) throw new Error('The squads contract is not set up yet.');
  const payer = privateKeyToAccount(key).address;
  const p = await readSquadParams();
  const stake = BigInt(Math.round((p.stakeUsd + p.bankrollUsd) * 1e6)) * 10n ** 12n; // the stake plus the vault bankroll
  const have = await pub().readContract({ address: USDSO, abi: ERC20, functionName: 'balanceOf', args: [payer] });
  if (have < stake) throw new Error(`The wallet that pays the stake needs at least $${p.stakeUsd + p.bankrollUsd} of USDso ($${p.stakeUsd} stake + $${p.bankrollUsd} trading bankroll that comes back to you). It has ${(Number(have) / 1e18).toFixed(2)}.`);
  const allowance = await pub().readContract({ address: USDSO, abi: ERC20, functionName: 'allowance', args: [payer, SQUADS_ADDRESS as Hex] });
  if (allowance < stake) await send2(key, USDSO, ERC20, 'approve', [SQUADS_ADDRESS, stake * 100n]);
  if (forOther(key, player)) {
    const pool = await (await import('./pools')).poolOf(ticker);
    return send(key, 'enterFor', [player, pool, ticker, BigInt(number), size]);
  }
  return send(key, 'enter', [ticker, BigInt(number), size]);
}

async function send2(key: Hex, to: Hex, abi: unknown, fn: string, args: unknown[]) {
  const hash = await walletFor(key).writeContract({ address: to, abi: abi as never, functionName: fn as never, args: args as never });
  const rc = await pub().waitForTransactionReceipt({ hash });
  if (rc.status !== 'success') throw new Error(`${fn} reverted on chain (${hash}).`);
  return hash;
}

async function viaPool(key: Hex, ticker: string, fn: 'leave' | 'confirm', number: number, player?: Hex) {
  if (forOther(key, player)) return send(key, `${fn}For`, [player, await (await import('./pools')).poolOf(ticker), ticker, BigInt(number)]);
  return send(key, fn, [ticker, BigInt(number)]);
}
export const leaveSquad = (key: Hex, ticker: string, number: number, player?: Hex) => viaPool(key, ticker, 'leave', number, player);
export const confirmSquad = (key: Hex, ticker: string, number: number, player?: Hex) => viaPool(key, ticker, 'confirm', number, player);
/** Anyone can finish an unfilled lobby once its confirm window ended: it locks, or it cancels and refunds. */
export const finishSquad = (key: Hex, ticker: string, number: number) => send(key, 'finish', [ticker, BigInt(number)]);

/** Pays a player their stake back or their winnings. Anyone may call it: the money goes to the player. */
export async function claimSquad(key: Hex, ticker: string, number: number, player: Hex): Promise<string> {
  const k = squadKey(ticker, number);
  if (forOther(key, player)) return send(key, 'claimFor', [player, await (await import('./pools')).poolOf(ticker), k]);
  return send(key, 'claim', [k, player]);
}

/** Anyone can settle a finished match: the contract reads each player's dreamDEX equity and computes the winner itself. */
export const settleSquad = (key: Hex, ticker: string, number: number) => send(key, 'settle', [squadKey(ticker, number)]);

/** The contract's own live team scores (average equity change in USDso, capped per player): exactly what settle will use. */
export async function squadScores(ticker: string, number: number): Promise<{ bulls: number; bears: number }> {
  const [bulls, bears] = await read<readonly [bigint, bigint]>('teamScores', [squadKey(ticker, number)]);
  return { bulls: Number(bulls) / 1e36, bears: Number(bears) / 1e36 };
}

/** Whether a player has already been paid for a match. */
export async function squadClaimed(ticker: string, number: number, player: Hex): Promise<boolean> {
  return read<boolean>('claimed', [squadKey(ticker, number), player]);
}

/** Sends a player's leftover bankroll from their vault back to them. Anyone may call it; the money only goes to the player. */
export const releaseSquad = (key: Hex, ticker: string, number: number, player: Hex) => send(key, 'release', [squadKey(ticker, number), player]);

/** A player's own trading vault for a match (a contract only they, or their approved bot, can trade from). */
export async function vaultAddress(ticker: string, number: number, player: string): Promise<Hex | null> {
  const v = await read<Hex>('vaultOf', [squadKey(ticker, number), player]);
  return /^0x0{40}$/i.test(v) ? null : v;
}
