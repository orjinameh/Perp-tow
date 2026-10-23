// Every game entry is a real dreamDEX perp order carrying this tag in its `userData`
// (a uint64 the pool stores and the indexer exposes). userData = (TAG << 32) | matchNumber,
// so matches can be rebuilt by anyone from public chain data, with no database of our own.
export const GAME_TAG = 0x544f57n; // "TOW"
export const MATCH_SIZE = 20;
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
