// Shape of PerpPositionChange / PerpPosition and a first leaderboard. Writes probe-leaders2.txt.
//   npx tsx scripts/probe-leaders2.mts
import { writeFileSync } from 'node:fs';

const out: string[] = [];
const log = (s: string) => out.push(s);
const url = 'https://hideki-dev.smk.somnia.host/v1/graphql';
const gql = async (query: string) => (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) })).json();
const F = 'account blockNumber closedSize entryPriceAfter entryPriceBefore exitPrice id kind logIndex orderId pool realizedPnl sizeAfter sizeBefore timestamp txHash';

const latest = await gql(`{ PerpPositionChange(limit: 6, order_by: {timestamp: desc}) { ${F} } }`);
log(`latest changes: ${JSON.stringify(latest.data?.PerpPositionChange ?? latest.errors?.[0]?.message)}`);

const rows = (await gql(`{ PerpPositionChange(limit: 1000, order_by: {timestamp: desc}) { account kind pool realizedPnl closedSize timestamp } }`)).data?.PerpPositionChange ?? [];
log(`rows fetched: ${rows.length}, newest ${rows[0]?.timestamp}, oldest ${rows[rows.length - 1]?.timestamp}`);
log(`kinds: ${JSON.stringify([...new Set(rows.map((r: { kind: string }) => r.kind))])}`);

const pnl = new Map<string, { pnl: bigint; closes: number; wins: number }>();
for (const r of rows) {
  if (!r.realizedPnl || r.realizedPnl === '0') continue;
  const e = pnl.get(r.account) ?? { pnl: 0n, closes: 0, wins: 0 };
  const v = BigInt(r.realizedPnl);
  e.pnl += v;
  e.closes += 1;
  if (v > 0n) e.wins += 1;
  pnl.set(r.account, e);
}
const top = [...pnl.entries()].sort((a, b) => (b[1].pnl > a[1].pnl ? 1 : -1)).slice(0, 8);
log(`traders with realized pnl in this window: ${pnl.size}`);
log(`top by raw realizedPnl: ${JSON.stringify(top.map(([a, v]) => ({ a, pnl: v.pnl.toString(), closes: v.closes, wins: v.wins })))}`);

const pools = await gql(`{ Pool(limit: 40) { id baseSymbol } }`);
log(`pools: ${JSON.stringify(pools.data?.Pool ?? pools.errors?.[0]?.message)}`);
const pos = await gql(`{ PerpPosition(limit: 4, order_by: {updatedAt: desc}) { account entryPriceX18 isLong pool realizedPnl size updatedAt } }`);
log(`positions: ${JSON.stringify(pos.data?.PerpPosition ?? pos.errors?.[0]?.message)}`);

writeFileSync('probe-leaders2.txt', out.join('\n') + '\n');
console.log('Wrote probe-leaders2.txt');
