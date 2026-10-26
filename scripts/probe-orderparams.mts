// Finds the perp pool's placeOrder / placeOrderFor function definitions inside the SDK files.
//   node --import tsx scripts/probe-orderparams.mts
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(process.cwd(), 'node_modules/@somnia-chain/markets-sdk/dist');
const files: string[] = [];
const walk = (d: string) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(js|d\.ts)$/.test(p)) files.push(p);
  }
};
walk(root);
let shown = 0;
const out: string[] = [];
const say = (...a: unknown[]) => out.push(a.join(' '));
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((l, i) => {
    if (shown > 14) return;
    if (/name:\s*['"](placeOrderFor|cancelOrderFor|reduceOrderFor|placeOrder)['"]/.test(l) || /['"]function (placeOrderFor|cancelOrderFor|reduceOrderFor)\(/.test(l)) {
      const block = lines.slice(Math.max(0, i - 2), i + 40).map((x) => x.trim()).join(' ').replace(/\s+/g, ' ');
      const cut = block.indexOf('outputs');
      say(`\n${f.replace(root + '/', '')}:${i + 1}\n  ${block.slice(0, cut > 0 ? cut : 700).slice(0, 900)}`);
      shown++;
    }
  });
}
say('\nFiles that mention placeOrderFor:');
for (const f of files) if (readFileSync(f, 'utf8').includes('placeOrderFor')) say('  ' + f.replace(root + '/', ''));

writeFileSync('probe-out.txt', out.join('\n') + '\n');
console.log(`Saved ${out.length} lines to probe-out.txt. Attach that file to the chat.`);
