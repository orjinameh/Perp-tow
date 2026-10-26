// Can we rank traders from the indexer? Writes probe-leaders.txt.
//   npx tsx scripts/probe-leaders.mts
import { writeFileSync } from 'node:fs';
import { generatePrivateKey } from 'viem/accounts';
import { SOMNIA_HIDEKI_TESTNET_ADDRESSES, SomniaMarkets } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';

const out: string[] = [];
const log = (s: string) => out.push(s);
const url = 'https://hideki-dev.smk.somnia.host/v1/graphql';
const gql = async (query: string) => (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) })).json();

// 1. Every entity and query root the indexer offers
const roots = await gql(`{ __schema { queryType { fields { name } } } }`);
const names: string[] = roots.data?.__schema?.queryType?.fields?.map((f: { name: string }) => f.name) ?? [];
log(`query roots (${names.length}): ${names.filter((n) => !/_by_pk|_aggregate|_stream/.test(n)).join(', ')}`);
log(`aggregate roots: ${names.filter((n) => /_aggregate/.test(n)).join(', ')}`);

// 2. Fields of anything that sounds like a trader, position, pnl or account
const re = /position|pnl|account|trader|leader|stat|margin|liquidat|funding|user/i;
for (const n of names.filter((n) => re.test(n) && !/_by_pk|_aggregate|_stream/.test(n))) {
  const t = await gql(`{ __type(name: "${n}") { fields { name type { name kind ofType { name } } } } }`);
  log(`${n}: ${t.data?.__type?.fields?.map((f: { name: string }) => f.name).join(', ') ?? JSON.stringify(t.errors?.[0]?.message)}`);
}

// 3. Sample rows from each of those
for (const n of names.filter((n) => re.test(n) && !/_by_pk|_aggregate|_stream/.test(n)).slice(0, 8)) {
  const t = await gql(`{ __type(name: "${n}") { fields { name type { kind name ofType { kind name } } } } }`);
  const scalars = (t.data?.__type?.fields ?? []).filter((f: { type: { kind: string; ofType?: { kind: string } } }) => f.type.kind === 'SCALAR' || f.type.ofType?.kind === 'SCALAR').map((f: { name: string }) => f.name).slice(0, 14);
  if (!scalars.length) continue;
  const r = await gql(`{ ${n}(limit: 2) { ${scalars.join(' ')} } }`);
  log(`sample ${n}: ${JSON.stringify(r.data?.[n] ?? r.errors?.[0]?.message)}`);
}

// 4. What the SDK itself exposes about other traders
const sdk = new SomniaMarkets({ chain: hidekiTestnet, indexerUrl: url, addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES, privateKey: generatePrivateKey() });
const own = (o: object) => [...new Set([...Object.getOwnPropertyNames(Object.getPrototypeOf(o)), ...Object.getOwnPropertyNames(o)])];
log(`client methods: ${own(sdk.client).filter((n) => /leader|rank|top|pnl|history|trader|account|position/i.test(n)).join(', ')}`);

writeFileSync('probe-leaders.txt', out.join('\n') + '\n');
console.log('Wrote probe-leaders.txt');
