// Lists recent orders of one wallet on one market, found by address prefix. Writes probe-owner.txt.
//   npx tsx scripts/probe-owner.mts 0xdE55B7 BTC 90      (prefix, market, minutes back)
import { writeFileSync } from 'node:fs';

const [prefix, ticker = 'BTC', minutes = '90'] = process.argv.slice(2);
if (!prefix) throw new Error('Usage: npx tsx scripts/probe-owner.mts 0xPREFIX BTC 90');
const url = process.env.INDEXER_URL ?? 'https://hideki-dev.smk.somnia.host/v1/graphql';
const q = async (query: string) => {
  const t0 = Date.now();
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
  return { j: await r.json(), ms: Date.now() - t0 };
};
const lines: string[] = [];
const mk = await q(`{ Market(where: {baseSymbol: {_eq: "${ticker}"}, perpRegistered: {_eq: true}}) { id } }`);
const pool = mk.j.data?.Market?.[0]?.id;
const since = Math.floor(Date.now() / 1000) - Number(minutes) * 60;
lines.push(`pool ${pool}, last ${minutes} min, owner starts with ${prefix.toLowerCase()}`);
const r = await q(`{ Order(limit: 50, where: {market_id: {_eq: "${pool}"}, placedAtTimestamp: {_gte: "${since}"}, owner: {_like: "${prefix.toLowerCase()}%"}}, order_by: {placedAtTimestamp: asc}) { owner isBid userData placedAtTimestamp placedTxHash } }`);
lines.push(`(${r.ms}ms) ${r.j.errors ? 'ERROR ' + r.j.errors[0].message : r.j.data.Order.length + ' orders'}`);
for (const o of r.j.data?.Order ?? []) lines.push(`${o.placedAtTimestamp} ${o.owner} bid=${o.isBid} userData=${o.userData} tx=${o.placedTxHash}`);
// Fills in the same window, to see whether the trade itself is visible even if the order row is not.
const f = await q(`{ Fill(limit: 5, where: {pool: {_eq: "${pool}"}}, order_by: {blockNumber: desc}) { txHash blockNumber } }`);
lines.push(`latest fills: ${f.j.errors ? 'ERROR ' + f.j.errors[0].message : JSON.stringify(f.j.data.Fill)}`);
writeFileSync('probe-owner.txt', lines.join('\n') + '\n');
console.log('Wrote probe-owner.txt');
