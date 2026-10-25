// Checks whether game-tagged orders reach the indexer. Writes probe-orders.txt (small).
//   npx tsx scripts/probe-orders.mts BTC
import { writeFileSync } from 'node:fs';
import { userDataRange } from '../lib/gameTag';

const ticker = process.argv[2] ?? 'BTC';
const url = process.env.INDEXER_URL ?? 'https://hideki-dev.smk.somnia.host/v1/graphql';
const q = async (query: string) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
  return r.json();
};
const lines: string[] = [];
const log = (s: string) => lines.push(s);

const mk = await q(`{ Market(where: {baseSymbol: {_eq: "${ticker}"}, perpRegistered: {_eq: true}}) { id } }`);
const pool = mk.data?.Market?.[0]?.id;
log(`pool: ${pool}`);
const since = Math.floor(Date.now() / 1000) - 86400;
const recent = await q(`{ Order(limit: 30, where: {market_id: {_eq: "${pool}"}, placedAtTimestamp: {_gte: "${since}"}}, order_by: {placedAtTimestamp: desc}) { owner isBid userData placedAtTimestamp placedTxHash } }`);
if (recent.errors) log(`recent orders error: ${recent.errors[0].message}`);
const rows = recent.data?.Order ?? [];
log(`recent orders returned: ${rows.length}`);
for (const o of rows) log(`${o.placedAtTimestamp} ${o.owner.slice(0, 8)} bid=${o.isBid} userData=${o.userData} tx=${o.placedTxHash.slice(0, 12)}`);
const { lo, hi } = userDataRange();
const tagged = await q(`{ Order(limit: 50, where: {market_id: {_eq: "${pool}"}, userData: {_gte: "${lo}", _lt: "${hi}"}}) { owner userData placedAtTimestamp } }`);
log(tagged.errors ? `tagged query error: ${tagged.errors[0].message}` : `tagged orders (any time, no sort): ${tagged.data.Order.length}`);
for (const o of tagged.data?.Order ?? []) log(`tagged: ${o.placedAtTimestamp} ${o.owner.slice(0, 8)} userData=${o.userData}`);
writeFileSync('probe-orders.txt', lines.join('\n') + '\n');
console.log('Wrote probe-orders.txt');
