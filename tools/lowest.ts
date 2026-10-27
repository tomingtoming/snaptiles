import { readFileSync } from 'node:fs';
import { parseRc } from '../src/rc/parser';
import { assemble } from '../src/model/assemble';
for (const f of process.argv.slice(2)) {
  const buf = readFileSync(f);
  let t = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if (/�/.test(t)) t = new TextDecoder('shift_jis').decode(buf);
  const m = parseRc(t);
  const vals = new Map(m.vals.map((v) => [v.name.toUpperCase(), v.default]));
  const a = assemble(m, (k) => vals.get(k.toUpperCase()))!;
  const ys = a.tiles.map((x) => x.position.y);
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const low = a.tiles.filter((x) => x.position.y - lo < 0.3).map((x) => `${x.type}#${x.chipIndex}`);
  console.log(f.split(/[\/]/).pop(), 'core y=0 lowest', lo.toFixed(1), 'highest', hi.toFixed(1), 'lowest tiles:', low.slice(0, 8).join(' '), low.length > 8 ? '…' : '');
}
