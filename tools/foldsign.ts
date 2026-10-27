// Score joint sign conventions against the corpus at rest (no physics):
//   bun tools/foldsign.ts <file...>
// 64 combinations of fold sign (N, S, E/W), Trim, Rudder and Wheel-rim signs.
// Score: wheels that sit at the model's lowest level (within 0.6 of the lowest tile) —
// a vehicle's wheels are what touches the ground.
import { readFileSync } from 'node:fs';
import { parseRc } from '../src/rc/parser';
import { assemble, FOLD_SIGN, JOINT_SIGN } from '../src/model/assemble';

const files = process.argv.slice(2);
const texts = files.map((f) => {
  const buf = readFileSync(f);
  let t = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if (/�/.test(t)) t = new TextDecoder('shift_jis').decode(buf);
  return t;
});
const models = texts.map((t) => parseRc(t));
const results: { label: string; score: number; detail: string }[] = [];
const pm = [1, -1];
for (const n of pm) for (const s of pm) for (const ew of pm) for (const trim of pm) for (const rud of pm) for (const wh of pm) {
  FOLD_SIGN.N = n; FOLD_SIGN.S = s; FOLD_SIGN.E = ew; FOLD_SIGN.W = ew;
  JOINT_SIGN.TRIM = trim; JOINT_SIGN.RUDDER = rud; JOINT_SIGN.WHEEL = wh;
  let score = 0;
  let total = 0;
  const detail: string[] = [];
  for (const [i, m] of models.entries()) {
    const vals = new Map(m.vals.map((v) => [v.name.toUpperCase(), v.default]));
    const a = assemble(m, (k) => vals.get(k.toUpperCase()));
    if (!a) continue;
    const ys = a.tiles.map((t) => t.position.y);
    const lowest = Math.min(...ys);
    const wheels = a.tiles.filter((t) => t.spec.wheel);
    const ok = wheels.filter((t) => t.position.y - lowest < 0.6).length;
    score += ok;
    total += wheels.length;
    detail.push(`${files[i].split(/[\\/]/).pop()?.replace(/\..*/, '')}:${ok}/${wheels.length}`);
  }
  const f = (v: number) => (v > 0 ? '+' : '-');
  results.push({ label: `N${f(n)} S${f(s)} EW${f(ew)} trim${f(trim)} rud${f(rud)} wheel${f(wh)}`, score, detail: `${score}/${total}  ${detail.join(' ')}` });
}
results.sort((a, b) => b.score - a.score);
for (const r of results.slice(0, 10)) console.log(r.label, ' ', r.detail);
