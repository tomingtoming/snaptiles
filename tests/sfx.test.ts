import {afterEach, describe, expect, it, vi} from 'vitest';
import {Sfx} from '../src/audio/sfx';
const param = () => ({value:0,setTargetAtTime:vi.fn(),setValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()});
const node = () => ({gain:param(),frequency:param(),Q:param(),connect:vi.fn(function(this: unknown){return this;}),start:vi.fn(),stop:vi.fn(),buffer:null,loop:false,type:''});
class FakeContext {
  static latest: FakeContext;
  state='running';currentTime=0;sampleRate=8;destination={};nodes: ReturnType<typeof node>[]=[];
  constructor(){FakeContext.latest=this;}
  createGain(){const n=node();this.nodes.push(n);return n;}
  createOscillator(){return this.createGain();}
  createBiquadFilter(){return this.createGain();}
  createBufferSource(){return this.createGain();}
  createBuffer(){return {getChannelData:()=>new Float32Array(16)};}
  resume=vi.fn(async()=>{});close=vi.fn(async()=>{});
}
const setup = (audio: unknown = FakeContext) => {
  vi.stubGlobal('AudioContext',audio);vi.stubGlobal('webkitAudioContext',undefined);
  vi.stubGlobal('localStorage',{getItem:()=>null,setItem:vi.fn()});
};
afterEach(()=>vi.unstubAllGlobals());
describe('optional synthesized audio',()=>{
 it('stays usable without an AudioContext API',()=>{
  setup(null);const s=new Sfx();expect(s.available).toBe(false);
  expect(()=>{s.unlock();s.unlock();s.update(30,1000);s.fire();s.thud(1);s.setMuted(true);}).not.toThrow();
 });
 it('initializes supported audio and updates its parameters',()=>{
  setup();const s=new Sfx();s.unlock();s.update(60,40000);s.fire();s.thud(.5);
  expect(s.available).toBe(true);expect(FakeContext.latest.nodes.some(n=>n.frequency.setTargetAtTime.mock.calls.length)).toBe(true);
  s.setMuted(true);expect(FakeContext.latest.nodes[0].gain.setTargetAtTime).toHaveBeenCalledWith(0,0,.05);
 });
 it('accepts the prefixed constructor when the standard one is absent',()=>{
  setup(null);vi.stubGlobal('webkitAudioContext',FakeContext);const s=new Sfx();s.unlock();expect(s.available).toBe(true);expect(FakeContext.latest.nodes.length).toBeGreaterThan(0);
 });
 it('disables failed initialization instead of throwing on every gesture',()=>{
  const create=vi.fn();setup(class {constructor(){create();throw new Error('device unavailable');}});
  const s=new Sfx();expect(()=>{s.unlock();s.unlock();s.update(1,1);}).not.toThrow();expect(create).toHaveBeenCalledTimes(1);expect(s.available).toBe(false);
 });
 it('closes a partially initialized context',()=>{
  setup(class extends FakeContext {createGain(): ReturnType<typeof node>{throw new Error('gain unavailable');}});
  const s=new Sfx();s.unlock();expect(s.available).toBe(false);expect(FakeContext.latest.close).toHaveBeenCalledTimes(1);
 });
 it('handles denied resume and retries on the next gesture',async()=>{
  setup();const s=new Sfx();s.unlock();const c=FakeContext.latest;c.state='suspended';c.resume.mockRejectedValue(new Error('denied'));
  s.unlock();await Promise.resolve();s.unlock();await Promise.resolve();expect(c.resume).toHaveBeenCalledTimes(2);expect(s.available).toBe(true);
 });
 it('keeps session mute control when preference storage is denied',()=>{
  setup();vi.stubGlobal('localStorage',{getItem:()=>{throw new Error('denied');},setItem:()=>{throw new Error('denied');}});
  const s=new Sfx();expect(s.muted).toBe(false);s.unlock();expect(()=>s.setMuted(true)).not.toThrow();expect(s.muted).toBe(true);
 });
});
