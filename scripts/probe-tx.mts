// Finds one order by its tx hash, then times the app's match query and two variants. Writes probe-tx.txt.
//   npx tsx scripts/probe-tx.mts 0x<tx hash of your entry> BTC
import { writeFileSync } from 'node:fs';
import { userDataRange, encodeUserData } from '../lib/gameTag';

const [tx, ticker = 'BTC'] = process.argv.slice(2);
if (!tx) throw new Error('Usage: npx tsx scripts/probe-tx.mts 0xTXHASH BTC');
const url = process.env.INDEXER_URL ?? 'https://hideki-dev.smk.somnia.host/v1/graphql';
const lines: string[] = [];
const log = (s: string) => lines.push(s);
const q = async (query: string) => {
  const t0 = Date.now();
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
  const j = await r.json();
  return { j, ms: Date.now() - t0 };
};
const ID = '{ owner market_id isBid userData placedAtTimestamp placedTxHash }';

const mk = await q(`{ Market(where: {baseSymbol: {_eq: "${ticker}"}, perpRegistered: {_eq: true}}) { id } }`);
const pool = mk.j.data?.Market?.[0]?.id;
log(`pool ${pool}`);
log(`expected tag for match #1: ${encodeUserData(1)}  range ${userDataRange().lo} .. ${userDataRange().hi}`);

const byTx = await q(`{ Order(where: {placedTxHash: {_eq: "${tx}"}}) ${ID} }`);
log(`by tx (${byTx.ms}ms): ${byTx.j.errors ? 'ERROR ' + byTx.j.errors[0].message : JSON.stringify(byTx.j.data.Order)}`);
const owner: string | undefined = byTx.j.data?.Order?.[0]?.owner;

const since = Math.floor(Date.now() / 1000) - 6 * 3600;
const { lo, hi } = userDataRange();
const variants: [string, string][] = [
  ['A: app query (pool + time + tag range, sorted)', `{ Order(limit: 100, where: {market_id: {_eq: "${pool}"}, placedAtTimestamp: {_gte: "${since}"}, userData: {_gte: "${lo}", _lt: "${hi}"}}, order_by: {placedAtTimestamp: asc}) ${ID} }`],
  ['B: same without sort', `{ Order(limit: 100, where: {market_id: {_eq: "${pool}"}, placedAtTimestamp: {_gte: "${since}"}, userData: {_gte: "${lo}", _lt: "${hi}"}}) ${ID} }`],
];
if (owner) variants.push(['C: by owner + tag range', `{ Order(limit: 100, where: {owner: {_eq: "${owner}"}, userData: {_gte: "${lo}", _lt: "${hi}"}}) ${ID} }`]);
for (const [name, query] of variants) {
  const r = await q(query);
  log(`${name} (${r.ms}ms): ${r.j.errors ? 'ERROR ' + r.j.errors[0].message : r.j.data.Order.length + ' rows ' + JSON.stringify(r.j.data.Order.slice(0, 3))}`);
}
writeFileSync('probe-tx.txt', lines.join('\n') + '\n');
console.log('Wrote probe-tx.txt');
