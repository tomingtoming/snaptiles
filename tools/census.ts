// Corpus census: which sides children attach to on triangle cowls (option 3/4),
// relative to the cowl's own attachment direction.  bun tools/census.ts <dir...>
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseRc, type ChipNode } from '../src/rc/parser';

const files: string[] = [];
const walk = (d: string) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(rcd|txt)$/i.test(n)) files.push(p);
  }
};
process.argv.slice(2).forEach(walk);

// rotate a direction into the frame where the cowl is attached from the south (parent at S)
const ORDER = ['N', 'E', 'S', 'W'];
const rel = (parentDir: string, childDir: string) => {
  // parentDir: where the cowl sits relative to its parent (so the parent is on the opposite side)
  const shift = (ORDER.indexOf(parentDir) - ORDER.indexOf('N') + 4) % 4; // N-attached = identity
  return ORDER[(ORDER.indexOf(childDir) - shift + 4) % 4];
};

const counts: Record<string, Record<string, number>> = {};
let total = 0;
const visit = (n: ChipNode) => {
  if (n.type.toLowerCase() === 'cowl' && n.dir) {
    const opt = (n.attrs.option ?? '0').trim();
    if (opt === '3' || opt === '4') {
      total++;
      for (const c of n.children) {
        if (!c.dir) continue;
        const r = rel(n.dir, c.dir);
        counts[opt] ??= {};
        counts[opt][r] = (counts[opt][r] ?? 0) + 1;
      }
    }
  }
  n.children.forEach(visit);
};
for (const f of files) {
  const buf = readFileSync(f);
  let text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if (/�/.test(text)) text = new TextDecoder('shift_jis').decode(buf);
  try {
    const m = parseRc(text);
    if (m.body) visit(m.body);
  } catch (e) {
    console.log('parse fail', f, (e as Error).message);
  }
}
console.log('triangle cowls:', total);
console.log('children sides relative to attachment (N = away from parent, S = toward parent):');
console.log(JSON.stringify(counts, null, 1));
