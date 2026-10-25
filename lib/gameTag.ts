// Every game entry is a real dreamDEX perp order carrying this tag in its `userData`
// (a uint64 the pool stores and the indexer exposes). userData = (TAG << 32) | matchNumber,
// so matches can be rebuilt by anyone from public chain data, with no database of our own.
export const GAME_TAG = 0x544f57n; // "TOW"
// Both can be changed without code edits: NEXT_PUBLIC_MATCH_SIZE=4 makes a quick demo match.
export const MATCH_SIZE = Number(process.env.NEXT_PUBLIC_MATCH_SIZE) > 1 ? Number(process.env.NEXT_PUBLIC_MATCH_SIZE) : 20;
// A match starts the moment its last seat is taken and runs this long (seconds).
export const MATCH_DURATION_SEC = Number(process.env.NEXT_PUBLIC_MATCH_SECONDS) > 0 ? Number(process.env.NEXT_PUBLIC_MATCH_SECONDS) : 300;
export const NOMINAL_STAKE_USD = 10;

export function encodeUserData(matchNumber: number): bigint {
  return (GAME_TAG << 32n) | BigInt(matchNumber);
}

export function userDataRange(): { lo: string; hi: string } {
  return { lo: (GAME_TAG << 32n).toString(), hi: ((GAME_TAG + 1n) << 32n).toString() };
}

export function matchNumberOf(userData: string): number {
  return Number(BigInt(userData) & 0xffffffffn);
}

// Lobby timing (seconds). Change with NEXT_PUBLIC_LOBBY_SECONDS; the registry must be deployed with the same values.
const num = (v: string | undefined, d: number) => (Number(v) > 0 ? Number(v) : d);
export const LOBBY_SECONDS = num(process.env.NEXT_PUBLIC_LOBBY_SECONDS, 300); // lobby stays open this long after its first player
export const CONFIRM_SECONDS = num(process.env.NEXT_PUBLIC_CONFIRM_SECONDS, 60); // "continue with fewer players?" window
export const TRADE_SECONDS = 60; // after the lock, players open their real trade; the price clock starts when it ends
export const LEVERAGE = num(process.env.NEXT_PUBLIC_LEVERAGE, 5); // same for every player; the $10 stake is the margin, the position is stake x leverage
export const MIN_PLAYERS = 2; // a match that locks short of this, or with one team only, is cancelled
