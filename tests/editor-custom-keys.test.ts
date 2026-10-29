import {describe,it,expect} from 'vitest';
import {ModelDocument} from '../src/editor/document';
import {KEY_TABLE} from '../src/input/keys';
import {parseRc} from '../src/rc/parser';
describe('custom control pairs',()=>{
 it('recognises every ordered pair of distinct supported keys',()=>{
  for(let first=0;first<17;first++)for(let second=0;second<17;second++){if(first===second)continue;
   const d=new ModelDocument('Body {Core(){E:Trim()}}');d.addSteeringControl(1,25,[first,second]);
   expect(d.controlKeyLabel('ST_STEER_1')).toBe(`${KEY_TABLE[first].glyph} / ${KEY_TABLE[second].glyph}`);
   expect(d.controlStrength('ST_STEER_1')).toBe(25);
  }
 });
 it('preserves custom held keys through resize, separation and history',()=>{
  const d=new ModelDocument('Body {Core(){E:Jet() W:Jet()}}');d.addThrottleControl(1,800,[6,10]);d.power(2,'-ST_THROTTLE_1');const original=d.text;
  d.separateControl(2,'power');d.setControlStrength('ST_THROTTLE_2',400);
  expect(d.controlKeyLabel('ST_THROTTLE_2')).toBe('C / V（保持）');expect(parseRc(d.text).keys.slice(-2).map(k=>[k.key,k.step])).toEqual([[6,4],[10,-4]]);
  expect(d.controlStrength('ST_THROTTLE_1')).toBe(800);d.undo();d.undo();expect(d.text).toBe(original);
 });
 it('rejects invalid pairs without edits',()=>{
  for(const pair of [[0,0],[-1,2],[0,17],[0,1.5]] as const){const d=new ModelDocument('Body {Core(){E:Jet()}}'),before=d.text;expect(()=>d.addPowerControl(1,100,pair)).toThrow();expect(d.text).toBe(before);expect(d.undoStack).toHaveLength(0)}
 });
});
