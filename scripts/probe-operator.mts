// Saves how dreamDEX's operator (bot) permission can be read, to probe-out.txt. Read only, no keys.
//   node --import tsx scripts/probe-operator.mts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPublicClient, http, parseAbi } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import { SOMNIA_HIDEKI_TESTNET_ADDRESSES, SomniaMarkets } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';

const out: string[] = [];
const say = (s: string) => out.push(s);
const j = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));

const root = join(process.cwd(), 'node_modules/@somnia-chain/markets-sdk/dist');
try {
  const mod = (await import(pathToFileURL(join(root, 'tradeAbi.js')).href)) as Record<string, unknown>;
  for (const name of ['operatorAuthorizationReadAbi', 'operatorRegistryWriteAbi']) {
    const abi = mod[name] as { name?: string; type?: string; inputs?: { type: string; name: string }[]; outputs?: { type: string }[] }[] | undefined;
    say(`\n${name}:`);
    for (const e of abi ?? []) say(`  ${e.type} ${e.name}(${(e.inputs ?? []).map((i) => `${i.type} ${i.name}`).join(', ')}) -> ${(e.outputs ?? []).map((o) => o.type).join(', ')}`);
  }
} catch (e) {
  say('could not load tradeAbi.js: ' + String(e).slice(0, 200));
}

const pub = createPublicClient({ chain: hidekiTestnet, transport: http('https://api.hideki2.infra.testnet.somnia.network') });
const sdk = new SomniaMarkets({ chain: hidekiTestnet, indexerUrl: process.env.INDEXER_URL ?? 'https://hideki-dev.smk.somnia.host/v1/graphql', addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES, privateKey: generatePrivateKey() });
const rows = (await sdk.client.listPerpMarkets()) as unknown as { baseSymbol: string; poolAddress: `0x${string}`; marginBank: `0x${string}` }[];
const btc = rows.find((r) => r.baseSymbol === 'BTC') ?? rows[0];
say(`\nperp pool ${btc.baseSymbol}: ${btc.poolAddress}   margin bank: ${btc.marginBank}`);
for (const fn of ['getOperatorPermissionsRegistry', 'operatorPermissionsRegistry', 'operatorRegistry', 'OPERATOR_PERMISSIONS_REGISTRY']) {
  for (const target of [btc.poolAddress, btc.marginBank]) {
    try {
      const v = await pub.readContract({ address: target, abi: parseAbi([`function ${fn}() view returns (address)`]), functionName: fn as never });
      say(`${fn}() on ${target === btc.poolAddress ? 'pool' : 'margin bank'} = ${v}`);
    } catch {
      /* not on this contract */
    }
  }
}
say('\nSDK client methods about operators: ' + Object.getOwnPropertyNames(Object.getPrototypeOf(sdk.client)).filter((n) => /operator|approved/i.test(n)).join(', '));
writeFileSync('probe-out.txt', out.join('\n') + '\n');
console.log(`Saved ${out.length} lines to probe-out.txt. Attach that file to the chat.`);
