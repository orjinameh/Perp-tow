import { GameMatch, PlayerSlot } from './types';
import { MATCH_SIZE, NOMINAL_STAKE_USD, matchNumberOf, userDataRange } from './gameTag';

interface RawOrder {
  owner: string;
  isBid: boolean;
  userData: string;
  placedAtBlock: string;
  placedTxHash: string;
}

async function gql<T>(query: string): Promise<T> {
  const res = await fetch('/api/indexer', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data as T;
}

// 2026-10-23 00:00 UTC: matches before this do not exist.
const GAME_EPOCH = 1792713600;

const short = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;

/**
 * Rebuilds this market's matches from public chain data: every order on the pool whose userData
 * carries the game tag. A player is an account (its first tagged order in that match counts);
 * the first 20 players, in order of placement, hold the seats. Nothing here is stored by us.
 */
export async function loadMatches(pool: string, ticker: string, me: string | null): Promise<GameMatch[]> {
  const { lo, hi } = userDataRange();

  // The indexer times out ("database query error") when asked to sort Order rows by columns it has no
  // index for (placedAtBlock, lastUpdatedAtBlock). Sorting by placedAtTimestamp within one market is
  // fast, so we filter and sort on that, starting from the day the game went live.
  const query = (since: number) => `{ Order(
    limit: 1000,
    where: {market_id: {_eq: "${pool}"}, placedAtTimestamp: {_gte: "${since}"}, userData: {_gte: "${lo}", _lt: "${hi}"}},
    order_by: {placedAtTimestamp: asc}
  ) { owner isBid userData placedAtBlock placedTxHash } }`;

  let d: { Order: RawOrder[] };
  try {
    d = await gql<{ Order: RawOrder[] }>(query(GAME_EPOCH));
  } catch {
    // Busy markets can still be too heavy for the whole window: retry on the last 3 hours only.
    d = await gql<{ Order: RawOrder[] }>(query(Math.floor(Date.now() / 1000) - 3 * 3600));
  }

  const byMatch = new Map<number, RawOrder[]>();
  for (const o of d.Order) {
    const n = matchNumberOf(o.userData);
    if (!byMatch.has(n)) byMatch.set(n, []);
    byMatch.get(n)!.push(o);
  }

  const matches: GameMatch[] = [];
  for (const [n, orders] of [...byMatch.entries()].sort((a, b) => a[0] - b[0])) {
    const seen = new Set<string>();
    const players: PlayerSlot[] = [];
    for (const o of orders) {
      const owner = o.owner.toLowerCase();
      if (seen.has(owner) || players.length >= MATCH_SIZE) continue;
      seen.add(owner);
      players.push({
        id: `${o.placedTxHash}`,
        address: short(o.owner),
        side: o.isBid ? 'bulls' : 'bears',
        joinedAt: `block ${o.placedAtBlock}`,
        isUser: me ? owner === me.toLowerCase() : false,
      });
    }
    const bulls = players.filter((p) => p.side === 'bulls').length;
    const bears = players.length - bulls;
    matches.push({
      id: `${ticker} #${n}`,
      market: ticker,
      bulls,
      bears,
      total: players.length,
      requiredPlayers: MATCH_SIZE,
      slotsRemaining: MATCH_SIZE - players.length,
      entryFee: NOMINAL_STAKE_USD,
      status: players.length >= MATCH_SIZE ? 'full' : 'filling',
      playersList: players,
    });
  }
  return matches;
}

/** The next free match number on a market. */
export function nextMatchNumber(matches: GameMatch[]): number {
  return matches.reduce((max, m) => Math.max(max, Number(m.id.split('#')[1])), 0) + 1;
}

/** An empty draft match: nothing is on chain until the first player enters it. */
export function draftMatch(ticker: string, number: number): GameMatch {
  return {
    id: `${ticker} #${number}`,
    market: ticker,
    bulls: 0,
    bears: 0,
    total: 0,
    requiredPlayers: MATCH_SIZE,
    slotsRemaining: MATCH_SIZE,
    entryFee: NOMINAL_STAKE_USD,
    status: 'filling',
    playersList: [],
  };
}
