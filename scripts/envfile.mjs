// Sets one NAME=value line in .env.local (replacing the old line, or adding it on its own line).
// Used by the deploy scripts so addresses never have to be copied by hand.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export function setEnv(name, value, file = '.env.local') {
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const lines = text.split(/\r?\n/).filter((l) => !l.startsWith(`${name}=`));
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  lines.push(`${name}=${value}`, '');
  writeFileSync(file, lines.join('\n'));
  console.log(`Saved ${name} in ${file}.`);
}
