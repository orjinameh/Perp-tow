// What can identify a game entry? Writes probe-chain.txt.
//   npx tsx scripts/probe-chain.mts 0x<entry tx hash>
import { writeFileSync } from 'node:fs';
import { createPublicClient, http } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import { SOMNIA_HIDEKI_TESTNET_ADDRESSES, SomniaMarkets } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';

const tx = process.argv[2] as `0x${string}` | undefined;
if (!tx) throw new Error('Usage: npx tsx scripts/probe-chain.mts 0xTXHASH');
const lines: string[] = [];
const log = (s: string) => lines.push(s);
const url = 'https://hideki-dev.smk.somnia.host/v1/graphql';
const gql = async (query: string) => (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) })).json();

for (const t of ['Fill', 'Order']) {
  const r = await gql(`{ __type(name: "${t}") { fields { name } } }`);
  log(`${t} fields: ${r.data?.__type?.fields?.map((f: { name: string }) => f.name).join(', ') ?? JSON.stringify(r.errors)}`);
}

const sdk = new SomniaMarkets({ chain: hidekiTestnet, indexerUrl: url, addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES, privateKey: generatePrivateKey() });
const names = (o: object) => [...new Set([...Object.getOwnPropertyNames(Object.getPrototypeOf(o)), ...Object.getOwnPropertyNames(o)])];
const re = /order|fill|trade|history|position|event|log/i;
log(`client methods: ${names(sdk.client).filter((n) => re.test(n)).join(', ')}`);
log(`trader methods: ${names(sdk.trader).filter((n) => re.test(n)).join(', ')}`);

const pub = createPublicClient({ chain: hidekiTestnet, transport: http('https://api.hideki2.infra.testnet.somnia.network') });
const rc = await pub.getTransactionReceipt({ hash: tx });
log(`tx block ${rc.blockNumber} status ${rc.status} from ${rc.from} to ${rc.to} logs ${rc.logs.length}`);
for (const l of rc.logs) log(`log ${l.logIndex} addr ${l.address} topic0 ${l.topics[0]} topics ${l.topics.length} dataBytes ${(l.data.length - 2) / 2}`);
writeFileSync('probe-chain.txt', lines.join('\n') + '\n');
console.log('Wrote probe-chain.txt');
