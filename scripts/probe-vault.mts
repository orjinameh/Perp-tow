// ONE read-only probe for the vault design. Lists every write function a contract would call to fund a margin account,
// place and close perp orders, and withdraw, plus how orders are keyed. Saves to probe-out.txt.
//   node --import tsx scripts/probe-vault.mts
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPublicClient, http, parseAbi } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import { SOMNIA_HIDEKI_TESTNET_ADDRESSES, SomniaMarkets } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';

const root = join(process.cwd(), 'node_modules/@somnia-chain/markets-sdk/dist');
const out: string[] = [];
type P = { name?: string; type: string; components?: P[] };
type Item = { type?: string; name?: string; stateMutability?: string; inputs?: P[]; outputs?: P[] };
const fmt = (p: P): string => (p.type.startsWith('tuple') ? `${p.type}{${(p.components ?? []).map(fmt).join(', ')}}${p.name ? ' ' + p.name : ''}` : `${p.type}${p.name ? ' ' + p.name : ''}`);
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.js') ? [join(d, e.name)] : []));
const seen = new Set<string>();
for (const f of walk(root)) {
  let mod: Record<string, unknown>;
  try { mod = (await import(pathToFileURL(f).href)) as Record<string, unknown>; } catch { continue; }
  for (const [name, val] of Object.entries(mod)) {
    if (!Array.isArray(val) || !/perp|margin|bank/i.test(name)) continue;
    for (const e of val as Item[]) {
      if (e?.type !== 'function' || /^(view|pure)$/.test(e.stateMutability ?? '')) continue;
      if (!/deposit|withdraw|placeOrder|cancel|close|reduce|collateral|transfer|operator|approve|subaccount|sub/i.test(e.name ?? '')) continue;
      const line = `${name}: ${e.name}(${(e.inputs ?? []).map(fmt).join(', ')})${(e.outputs ?? []).length ? ' -> ' + (e.outputs ?? []).map(fmt).join(', ') : ''}`;
      if (!seen.has(line)) { seen.add(line); out.push(line); }
    }
  }
}
// Does the pool accept a contract as the trading account? Look for code at the bank and pool, and the bank's collateral token.
const pub = createPublicClient({ chain: hidekiTestnet, transport: http('https://api.hideki2.infra.testnet.somnia.network') });
const sdk = new SomniaMarkets({ chain: hidekiTestnet, indexerUrl: 'https://hideki-dev.smk.somnia.host/v1/graphql', addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES, privateKey: generatePrivateKey() });
const rows = (await sdk.client.listPerpMarkets()) as unknown as { baseSymbol: string; poolAddress: `0x${string}`; marginBank: `0x${string}` }[];
const btc = rows.find((r) => r.baseSymbol === 'BTC') ?? rows[0];
out.push('', `BTC pool ${btc.poolAddress} marginBank ${btc.marginBank}`);
for (const sig of ['function collateralToken() view returns (address)', 'function collateral() view returns (address)', 'function asset() view returns (address)']) {
  try { const n = sig.slice(9, sig.indexOf('(')); out.push(`  OK ${sig} => ${await pub.readContract({ address: btc.marginBank, abi: parseAbi([sig]), functionName: n as never })}`); } catch { out.push(`  no ${sig}`); }
}
writeFileSync('probe-out.txt', out.join('\n') + '\n');
console.log(`Saved ${out.length} lines to probe-out.txt. Attach that file to the chat.`);
