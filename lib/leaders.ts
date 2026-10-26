import { gql } from './indexer';

export interface Leader {
  account: `0x${string}`;
  pnlUsd: number; // all-time realised profit on this market, in USD
  direction: 'long' | 'short' | 'flat'; // what they hold right now
  sizeBase: number; // open size in base units (e.g. BTC)
  entryUsd: number;
  wins: number; // winning closes among their last closing trades
  closes: number;
  lastActive: number; // unix seconds of their latest position change
}

interface PosRow {
  account: `0x${string}`;
  isLong: boolean;
  size: string;
  entryPriceX18: string;
  realizedPnl: string;
  updatedAt: string;
}
interface ChangeRow {
  realizedPnl: string;
  timestamp: string;
}

const X18 = 1e18;
const asUsd = (raw: string) => Number(BigInt(raw) / 10n ** 12n) / 1e6; // x18 integer string to USD without losing the sign

/**
 * The most profitable traders on one market, from the indexer's own position records:
 * all-time realised profit (PerpPosition) plus win rate over their latest closing trades (PerpPositionChange).
 */
export async function loadLeaders(pool: string, baseDecimals: number, top = 12): Promise<Leader[]> {
  const pos = await gql<{ PerpPosition: PosRow[] }>(`{ PerpPosition(
    limit: 80,
    where: {pool: {_eq: "${pool}"}},
    order_by: {realizedPnl: desc}
  ) { account isLong size entryPriceX18 realizedPnl updatedAt } }`);

  // Merge duplicate accounts, then rank by profit ourselves so the order never depends on how the column sorts.
  const rows = pos.PerpPosition.filter((r) => r.realizedPnl && BigInt(r.realizedPnl) > 0n)
    .sort((a, b) => (BigInt(b.realizedPnl) > BigInt(a.realizedPnl) ? 1 : -1))
    .slice(0, top);
  if (rows.length === 0) return [];

  const asks = rows
    .map(
      (r, i) => `a${i}: PerpPositionChange(limit: 120, where: {account: {_eq: "${r.account}"}, pool: {_eq: "${pool}"}}, order_by: {timestamp: desc}) { realizedPnl timestamp }`,
    )
    .join('\n');
  const hist = await gql<Record<string, ChangeRow[]>>(`{ ${asks} }`).catch(() => ({}) as Record<string, ChangeRow[]>);

  return rows.map((r, i) => {
    const changes = hist[`a${i}`] ?? [];
    const closes = changes.filter((c) => c.realizedPnl && c.realizedPnl !== '0');
    const size = BigInt(r.size);
    return {
      account: r.account,
      pnlUsd: asUsd(r.realizedPnl),
      direction: size === 0n ? 'flat' : r.isLong ? 'long' : 'short',
      sizeBase: Number(size) / 10 ** baseDecimals,
      entryUsd: Number(r.entryPriceX18) / X18,
      wins: closes.filter((c) => BigInt(c.realizedPnl) > 0n).length,
      closes: closes.length,
      lastActive: Number(changes[0]?.timestamp ?? r.updatedAt),
    };
  });
}

/** What one trader holds on one market right now. */
export async function leaderDirection(pool: string, account: string): Promise<'long' | 'short' | 'flat'> {
  const d = await gql<{ PerpPosition: { isLong: boolean; size: string }[] }>(
    `{ PerpPosition(limit: 1, where: {pool: {_eq: "${pool}"}, account: {_eq: "${account.toLowerCase()}"}}) { isLong size } }`,
  );
  const p = d.PerpPosition[0];
  if (!p || BigInt(p.size) === 0n) return 'flat';
  return p.isLong ? 'long' : 'short';
}
