// Checks, read only, what a contract could read from dreamDEX to verify a result on chain. Saves to probe-out.txt.
//   node --import tsx scripts/probe-onchain.mts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPublicClient, http, parseAbi } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import { SOMNIA_HIDEKI_TESTNET_ADDRESSES, SomniaMarkets } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';

const out: string[] = [];
const say = (s: string) => out.push(s);
const root = join(process.cwd(), 'node_modules/@somnia-chain/markets-sdk/dist');
const pub = createPublicClient({ chain: hidekiTestnet, transport: http('https://api.hideki2.infra.testnet.somnia.network') });

const mod = (await import(pathToFileURL(join(root, 'tradeAbi.js')).href)) as Record<string, unknown>;
type Item = { type?: string; name?: string; stateMutability?: string; inputs?: { type: string; name: string }[]; outputs?: { type: string; name?: string }[] };
for (const [name, val] of Object.entries(mod)) {
  if (!Array.isArray(val)) continue;
  for (const e of val as Item[]) {
    if (e.type === 'function' && /^(view|pure)$/.test(e.stateMutability ?? '') && /mark|price|position|equity|pnl|margin|account|collateral/i.test(e.name ?? '')) {
      say(`${name}: ${e.name}(${(e.inputs ?? []).map((i) => `${i.type} ${i.name}`).join(', ')}) -> ${(e.outputs ?? []).map((o) => `${o.type}${o.name ? ' ' + o.name : ''}`).join(', ')}`);
    }
  }
}

const sdk = new SomniaMarkets({ chain: hidekiTestnet, indexerUrl: process.env.INDEXER_URL ?? 'https://hideki-dev.smk.somnia.host/v1/graphql', addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES, privateKey: generatePrivateKey() });
const rows = (await sdk.client.listPerpMarkets()) as unknown as { baseSymbol: string; poolAddress: `0x${string}` }[];
const btc = rows.find((r) => r.baseSymbol === 'BTC') ?? rows[0];
say(`\nTrying tryGetMarkPrice on the ${btc.baseSymbol} pool ${btc.poolAddress}:`);
for (const sig of ['function tryGetMarkPrice() view returns (bool ok, uint256 price)', 'function tryGetMarkPrice() view returns (uint256 price, bool ok)', 'function tryGetMarkPrice() view returns (uint256)', 'function getMarkPrice() view returns (uint256)']) {
  try {
    const name = sig.slice(9, sig.indexOf('('));
    const v = await pub.readContract({ address: btc.poolAddress, abi: parseAbi([sig]), functionName: name as never });
    say(`  OK  ${sig} => ${JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x))}`);
  } catch {
    say(`  no  ${sig}`);
  }
}
writeFileSync('probe-out.txt', out.join('\n') + '\n');
console.log(`Saved ${out.length} lines to probe-out.txt. Attach that file to the chat.`);
