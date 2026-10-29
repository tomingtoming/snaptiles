import {describe,it,expect} from 'vitest';
import {KeyState} from '../src/input/keys';
function key(target:EventTarget,type:string,code:string,extra:Record<string,unknown>={}) {
 const event=new Event(type,{cancelable:true});Object.assign(event,{code,...extra});target.dispatchEvent(event);
}
describe('independent input sources',()=>{
 it('keeps keyboard input when a screen pointer is released, and vice versa',()=>{
  const target=new EventTarget(),keys=new KeyState(target);
  key(target,'keydown','ArrowUp');keys.press(0,12);keys.release(0,12);expect(keys.isDown(0)).toBe(true);
  keys.press(0,13);key(target,'keyup','ArrowUp');expect(keys.isDown(0)).toBe(true);
  keys.release(0,13);expect(keys.isDown(0)).toBe(false);
 });
 it('keeps aliases independent and repeated downs idempotent',()=>{
  const target=new EventTarget(),keys=new KeyState(target);keys.setWasdAliases([]);
  key(target,'keydown','ArrowUp');key(target,'keydown','KeyW');key(target,'keydown','KeyW');
  key(target,'keyup','ArrowUp');expect(keys.isDown(0)).toBe(true);
  keys.setWasdAliases([15]);key(target,'keyup','KeyW');expect(keys.isDown(0)).toBe(false);
 });
 it('releases only one pointer, tolerates duplicate release, and clears on blur',()=>{
  const target=new EventTarget(),keys=new KeyState(target);
  keys.press(0,1);keys.press(0,2);keys.release(0,1);keys.release(0,1);expect(keys.isDown(0)).toBe(true);
  target.dispatchEvent(new Event('blur'));expect(keys.isDown(0)).toBe(false);
  keys.release(0,2);keys.press(0,3);expect(keys.isDown(0)).toBe(true);keys.clear();expect(keys.down.size).toBe(0);
 });
 it('ignores shortcuts without releasing another held source',()=>{
  const target=new EventTarget(),keys=new KeyState(target);keys.press(4,1);
  key(target,'keydown','KeyZ',{ctrlKey:true});key(target,'keyup','KeyZ');expect(keys.isDown(4)).toBe(true);
  keys.release(4,1);expect(keys.isDown(4)).toBe(false);
 });
});
