import {describe,it,expect} from 'vitest';
import {parseRc} from '../src/rc/parser';
import {ModelDocument} from '../src/editor/document';
describe('unhandled section diagnostics',()=>{
 it('reports each unknown section with its original name and line',()=>{
  const source='// header\nMetadata { text="Body { }" }\nBody {Core(){E:Chip(user1=7)}}\nExtra { nested {data=3} }';
  const model=parseRc(source);expect(model.warnings).toHaveLength(2);
  expect(model.warnings[0]).toContain('「Metadata」(line 2)');expect(model.warnings[1]).toContain('「Extra」(line 4)');
  const d=new ModelDocument(source);d.angle(1,12);expect(d.text).toContain('Metadata { text="Body { }" }');expect(d.text).toContain('Extra { nested {data=3} }');
  expect(d.nodes()[1].attrs.user1).toBe('7');d.undo();expect(d.text).toBe(source);
 });
 it('does not report known aliases, comments or strings inside scripts',()=>{
  const model=parseRc('vAr {A(default=0)} KEY {} bOdY {Core()} Script {} Lua { local text="Extra {}" -- Ignored {}\n } // Tail {}');
  expect(model.warnings).toEqual([]);expect(model.script!.lang).toBe('lua');
 });
});
