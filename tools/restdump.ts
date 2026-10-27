// Rest-pose check of the fold convention: bun tools/restdump.ts <file...>
// For each model prints wheel heights relative to the core at REST (no physics), once as
// written and once with every angle negated. Vehicles should have their wheels below the core.
import { readFileSync } from 'node:fs';
import { parseRc } from '../src/rc/parser';
import { assemble } from '../src/model/assemble';

for (const f of process.argv.slice(2)) {
  const buf = readFileSync(f);
  let text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if (/�/.test(text)) text = new TextDecoder('shift_jis').decode(buf);
  const flipped = text.replace(/\b(angle)\s*=\s*/gi, '$1=-(').replace(/(angle=-\([^,)]*)/gi, '$1)');
  for (const [label, src] of [['as-written', text], ['negated   ', flipped]] as const) {
    const m = parseRc(src);
    const vals = new Map(m.vals.map((v) => [v.name.toUpperCase(), v.default]));
    const a = assemble(m, (n) => vals.get(n.toUpperCase()));
    if (!a) continue;
    const core = a.tiles[0];
    const wheels = a.tiles.filter((t) => t.spec.wheel).map((t) => +(t.position.y - core.position.y).toFixed(2));
    const minY = Math.min(...a.tiles.map((t) => t.position.y - core.position.y));
    const maxY = Math.max(...a.tiles.map((t) => t.position.y - core.position.y));
    console.log(`${f.split(/[\\/]/).pop()?.padEnd(16)} ${label} wheels-y=[${wheels.join(',')}] lowest=${minY.toFixed(1)} highest=${maxY.toFixed(1)}`);
  }
}
