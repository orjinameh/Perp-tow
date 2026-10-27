import { gql } from './indexer';

export interface PlayerScore {
  address: string;
  pnl: number; // realized profit in USD during the match
  traded: number; // USD notional closed during the match
  ret: number; // pnl / traded: return on money put to work, so leverage does not decide the winner
  trades: number;
}

export interface TeamScore {
  red: number; // average return of the Red players
  blue: number;
  gap: number; // red - blue, drives the rope
  players: PlayerScore[];
}

interface Change { account: string; closedSize: string; exitPrice: string; realizedPnl: string; timestamp: string }

/**
 * Real fills from the indexer between the lock and the end of the match, for one pool.
 * Assumes prices and P&L are x1e18 and sizes use the market's base decimals, as the indexer reports them.
 */
export async function loadScores(pool: string, accounts: string[], fromSec: number, toSec: number, baseDecimals: number): Promise<PlayerScore[]> {
  if (!accounts.length) return [];
  const list = accounts.map((a) => `"${a.toLowerCase()}"`).join(',');
  const d = await gql<{ PerpPositionChange: Change[] }>(
    `{ PerpPositionChange(limit: 1000, where: {pool: {_ilike: "${pool}"}, account: {_in: [${list}]}, timestamp: {_gte: "${fromSec}", _lte: "${toSec}"}, closedSize: {_gt: "0"}}) { account closedSize exitPrice realizedPnl timestamp } }`,
  );
  const by = new Map<string, PlayerScore>(accounts.map((a) => [a.toLowerCase(), { address: a, pnl: 0, traded: 0, ret: 0, trades: 0 }]));
  for (const c of d.PerpPositionChange) {
    const s = by.get(c.account.toLowerCase());
    if (!s) continue;
    s.pnl += Number(BigInt(c.realizedPnl)) / 1e18;
    s.traded += (Number(BigInt(c.closedSize)) / 10 ** baseDecimals) * (Number(BigInt(c.exitPrice)) / 1e18);
    s.trades += 1;
  }
  for (const s of by.values()) s.ret = s.traded > 0 ? s.pnl / s.traded : 0;
  return [...by.values()];
}

/** Team score = the average return of its players. A player who never traded counts as 0, so sitting still drags a team down. */
export function teamScore(players: { address: string; team: 0 | 1 | 2 }[], scores: PlayerScore[]): TeamScore {
  const get = (a: string) => scores.find((s) => s.address.toLowerCase() === a.toLowerCase());
  const avg = (t: 1 | 2) => {
    const m = players.filter((p) => p.team === t);
    return m.length ? m.reduce((x, p) => x + (get(p.address)?.ret ?? 0), 0) / m.length : 0;
  };
  const red = avg(1), blue = avg(2);
  return { red, blue, gap: red - blue, players: scores };
}

/** 1 Red, 2 Blue, 3 tie. */
export const winner = (t: TeamScore): 1 | 2 | 3 => (Math.abs(t.gap) < 1e-9 ? 3 : t.gap > 0 ? 1 : 2);
