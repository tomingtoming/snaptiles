import { describe, expect, it } from 'vitest';
import { candidates } from '../src/editor/completion';

const SRC = `Val { ENGINE(default=0,min=-2000,max=2000) TARGET_H(default=3) }
Key { 0:ENGINE(step=100) }
Body { Core(){ N:Chip(name=NOSE){ } } }
Lua {
targetSpeed = 10
function OnFrame()
  local speedNow = _VZ(0)
  @@
end
}
`;
// the source with `typed` at the marker, and the caret right after it
const at = (_marker: string, typed: string) => {
  const i = SRC.indexOf('@@');
  return { text: SRC.slice(0, i) + typed + SRC.slice(i + 2), caret: i + typed.length };
};
const labels = (typed: string) => {
  const { text, caret } = at('', typed);
  return candidates(text, caret)?.list.map((c) => `${c.kind}:${c.label}`) ?? [];
};

describe('deterministic completion', () => {
  it('puts the model own names first, then the API with its description', () => {
    expect(labels('tar')).toEqual(['変数:targetSpeed', 'Val:TARGET_H']);
    expect(labels('speed')).toEqual(['変数:speedNow']);
    expect(labels('EN')).toEqual(['Val:ENGINE', 'Lua:end']); // prefixes match case-insensitively
    expect(labels('NO')).toEqual(['部品:NOSE', 'Lua:not']);
    const v = candidates(at('', '_V').text, at('', '_V').caret)!.list;
    expect(v.map((c) => c.label)).toEqual(['_VEL', '_VX', '_VY', '_VZ']);
    expect(v[1].insert).toBe('_VX(|)');
    expect(v[1].detail).toMatch(/速度/);
  });

  it('lists library members after math. and keywords by prefix', () => {
    expect(labels('math.s')).toEqual(['ライブラリ:math.sin', 'ライブラリ:math.sqrt']);
    expect(labels('math.p')).toEqual(['ライブラリ:math.pi', 'ライブラリ:math.pow']);
    expect(labels('fu')).toEqual(['Lua:function']);
    expect(labels('ma')).toEqual(['ライブラリ:math']);
  });

  it('stays out of the .rc sections and repeats exactly', () => {
    const outside = SRC.indexOf('ENGINE(default') + 3;
    expect(candidates(SRC, outside)).toBeNull();
    const { text, caret } = at('', 'o');
    expect(candidates(text, caret)).toEqual(candidates(text, caret));
  });
});
