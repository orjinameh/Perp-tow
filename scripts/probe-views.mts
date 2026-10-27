// Read only: lists every view function in the SDK's ABIs that takes an account or returns a position/equity/pnl. Saves to probe-out.txt.
//   node --import tsx scripts/probe-views.mts
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = join(process.cwd(), 'node_modules/@somnia-chain/markets-sdk/dist');
const out: string[] = [];
type Item = { type?: string; name?: string; stateMutability?: string; inputs?: { type: string; name: string }[]; outputs?: { type: string; name?: string }[] };
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.js') ? [join(d, e.name)] : []));
for (const f of walk(root)) {
  let mod: Record<string, unknown>;
  try { mod = (await import(pathToFileURL(f).href)) as Record<string, unknown>; } catch { continue; }
  for (const [name, val] of Object.entries(mod)) {
    if (!Array.isArray(val)) continue;
    for (const e of val as Item[]) {
      if (e?.type !== 'function' || !/^(view|pure)$/.test(e.stateMutability ?? '')) continue;
      const ins = (e.inputs ?? []).map((i) => `${i.type} ${i.name}`).join(', ');
      const outs = (e.outputs ?? []).map((o) => `${o.type}${o.name ? ' ' + o.name : ''}`).join(', ');
      if (/position|equity|pnl|margin|collateral|account|balance|funding/i.test(`${e.name} ${ins} ${outs}`)) out.push(`${f.replace(root, '')} ${name}: ${e.name}(${ins}) -> ${outs}`);
    }
  }
}
writeFileSync('probe-out.txt', out.join('\n') + '\n');
console.log(`Saved ${out.length} lines to probe-out.txt. Attach that file to the chat.`);
