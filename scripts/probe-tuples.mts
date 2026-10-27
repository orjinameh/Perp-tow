// Read only: prints the fields of the margin bank's getPosition / getAccountState tuples. Saves to probe-out.txt.
//   node --import tsx scripts/probe-tuples.mts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

type P = { name?: string; type: string; components?: P[] };
const fmt = (p: P): string => (p.type.startsWith('tuple') ? `${p.type}{${(p.components ?? []).map(fmt).join(', ')}}${p.name ? ' ' + p.name : ''}` : `${p.type}${p.name ? ' ' + p.name : ''}`);
const mod = (await import(pathToFileURL(join(process.cwd(), 'node_modules/@somnia-chain/markets-sdk/dist/readsAbi.js')).href)) as Record<string, unknown>;
const out: string[] = [];
for (const e of (mod.marginBankReadAbi ?? []) as { type?: string; name?: string; outputs?: P[] }[]) {
  if (e.type === 'function' && ['getPosition', 'getAccountState', 'getCollateralBasis', 'getCreditFloor'].includes(e.name ?? '')) out.push(`${e.name} -> ${(e.outputs ?? []).map(fmt).join(', ')}`);
}
writeFileSync('probe-out.txt', out.join('\n') + '\n');
console.log(`Saved ${out.length} lines to probe-out.txt. Attach that file to the chat.`);
