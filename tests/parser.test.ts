import { describe, expect, it } from 'vitest';
import { countNodes, parseRc } from '../src/rc/parser';
import { evalExpr } from '../src/rc/expr';

const CAR = `
// comment
Val
{
  HANDLE(default=0, min=-30, max=30, step=5)
  ENGINE(default=0, min=-500, max=500, step=100, disp=0)
  BRAKE(default=0,max=100,step=100)
}
Key
{
  0:ENGINE(step=100)
  1:ENGINE(step=-100)
  2:HANDLE(step=-5), BRAKE(step=0)
  3:HANDLE(step=5)
}
Body {
  Core(){
    N:Frame(angle=0){
      W:Rudder(angle=HANDLE){ W:Wheel(power=ENGINE, brake=BRAKE, color=#ff0000) }
      E:Rudder(angle=-HANDLE){ E:Wheel(power=-ENGINE) }
    }
    S:Chip(){ W:Wheel(power=ENGINE*2) E:Wheel() }
  }
}
Script
{
  if _KEY(0)=1 { x = 1 }
}
Lua
{
  local t = { a = 1 } -- braces inside lua { }
  if _KEY(0) > 0 then print("go") end
}
`;

describe('parseRc', () => {
  it('parses sections', () => {
    const m = parseRc(CAR);
    expect(m.vals.map((v) => v.name)).toEqual(['HANDLE', 'ENGINE', 'BRAKE']);
    expect(m.vals[0]).toMatchObject({ default: 0, min: -30, max: 30, step: 5 });
    expect(m.vals[2]).toMatchObject({ min: 0, max: 100 });
    expect(m.keys).toEqual([
      { key: 0, var: 'ENGINE', step: 100 },
      { key: 1, var: 'ENGINE', step: -100 },
      { key: 2, var: 'HANDLE', step: -5 },
      { key: 2, var: 'BRAKE', step: 0 },
      { key: 3, var: 'HANDLE', step: 5 },
    ]);
    expect(m.body?.type).toBe('Core');
    expect(countNodes(m.body)).toBe(9);
    const frame = m.body!.children[0];
    expect(frame).toMatchObject({ type: 'Frame', dir: 'N' });
    expect(frame.children[0].attrs.angle).toBe('HANDLE');
    expect(frame.children[1].attrs.angle).toBe('- HANDLE');
    expect(frame.children[0].children[0].attrs.color).toBe('#ff0000');
    expect(evalExpr(frame.children[0].children[0].attrs.color, () => undefined)).toBe(0xff0000);
    expect(m.script?.lang).toBe('lua');
    expect(m.script?.source).toContain('print("go")');
    expect(m.script?.source).toContain('{ a = 1 }');
  });
  it('evaluates expressions', () => {
    const env = (n: string) => ({ HANDLE: 10, ENGINE: -3 } as Record<string, number>)[n];
    expect(evalExpr('HANDLE', env)).toBe(10);
    expect(evalExpr('- HANDLE', env)).toBe(-10);
    expect(evalExpr('ENGINE*2 + 1', env)).toBe(-5);
    expect(evalExpr('(1+2)*3', env)).toBe(9);
    expect(evalExpr('NOPE', env)).toBe(0);
  });
});
