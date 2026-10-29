import {describe,it,expect} from 'vitest';
import {assemble,TYPES} from '../src/model/assemble';
import {parseRc} from '../src/rc/parser';

describe('unsupported part diagnostics',()=>{
 for(const type of ['Wheeel','constructor','toString','__proto__']) it(`does not substitute ${type} with a Chip`,()=>{
  const model=parseRc(`Body {\nCore(){\n E:${type}(angle=12)\n}}`);
  expect(()=>assemble(model,()=>0)).toThrow(`未対応の部品「${type}」です (line 3)`);
  expect(model.body!.children[0].type).toBe(type);
  expect(model.body!.children[0].attrs.angle).toBe('12');
 });
 it('continues to accept every supported type case-insensitively',()=>{
  for(const type of Object.keys(TYPES)){
   const model=parseRc(`Body {Core(){E:${type.toUpperCase()}()}}`);
   expect(assemble(model,()=>0)!.tiles[1].spec).toBe(TYPES[type]);
  }
 });
});
