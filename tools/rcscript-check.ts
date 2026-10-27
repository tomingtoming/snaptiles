import { readFileSync } from 'node:fs';
import { parseRc } from '../src/rc/parser';
import { RcScript } from '../src/scripting/rcscript';
for (const f of process.argv.slice(2)) {
  const buf = readFileSync(f);
  let t = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if (/�/.test(t)) t = new TextDecoder('shift_jis').decode(buf);
  const m = parseRc(t);
  if (!m.script || m.script.lang !== 'rc') { console.log('skip', f); continue; }
  try {
    const s = new RcScript(m.script.source);
    console.log('ok  ', f.split(/[\/]/).pop(), 'lines', m.script.source.split('\n').length, 'stmts', (s as unknown as { stmts: unknown[] }).stmts.length);
  } catch (e) { console.log('FAIL', f.split(/[\/]/).pop(), (e as Error).message); }
}
