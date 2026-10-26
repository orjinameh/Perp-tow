// Prints how the SDK exposes bot grants and placeOrderFor, so the game can use them. Read only, no keys.
//   node --import tsx scripts/probe-operator.mts
import * as sdk from '@somnia-chain/markets-sdk';

const seen = new Set<unknown>();
const hits: string[] = [];
function walk(v: unknown, path: string, depth: number) {
  if (v === null || (typeof v !== 'object' && typeof v !== 'function') || seen.has(v) || depth > 4) return;
  seen.add(v);
  if (Array.isArray(v)) {
    for (const e of v) {
      const o = e as { type?: string; name?: string; inputs?: { name: string; type: string }[]; outputs?: { type: string }[] };
      if (o && o.type === 'function' && o.name && /OrderFor|Operator|operator/.test(o.name)) {
        hits.push(`${path}: ${o.name}(${(o.inputs ?? []).map((i) => `${i.type} ${i.name}`).join(', ')})`);
      }
    }
  }
  for (const k of Object.keys(v as object)) {
    try {
      walk((v as Record<string, unknown>)[k], `${path}.${k}`, depth + 1);
    } catch {
      /* skip */
    }
  }
}
for (const [name, val] of Object.entries(sdk)) {
  if (/SELECTOR/.test(name)) console.log(name, '=', String(val));
  walk(val, name, 0);
}
console.log('\nABI entries:');
for (const h of [...new Set(hits)].slice(0, 60)) console.log(h);
console.log('\nExports with OrderFor/Operator in the name:');
console.log(Object.keys(sdk).filter((k) => /OrderFor|Operator/i.test(k)).join('\n'));
