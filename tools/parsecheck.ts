// bun tools/parsecheck.ts <file...> — parse each model and report failures with file names
import { readFileSync } from 'node:fs';
import { parseRc } from '../src/rc/parser';
for (const f of process.argv.slice(2)) {
  const buf = readFileSync(f);
  let t = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if (/�/.test(t)) t = new TextDecoder('shift_jis').decode(buf);
  try {
    const m = parseRc(t);
    console.log('ok  ', f.split(/[\/]/).slice(-2).join('/'), 'roots', m.bodies.length);
  } catch (e) {
    console.log('FAIL', f.split(/[\/]/).slice(-2).join('/'), (e as Error).message);
  }
}
