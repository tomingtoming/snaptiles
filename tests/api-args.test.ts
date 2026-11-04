import { describe, expect, it } from 'vitest';
import { RustSimulation } from '../src/sim/rust-simulation';
import { KeyState } from '../src/input/keys';

// The script API from the page takes string arguments too (_GET(chip, 'ANGLE')) and returns text results intact.
describe('api() from the page', () => {
  it('passes numbers and strings both ways', async () => {
    const sim = new RustSimulation('Val { A(default=30,min=-90,max=90) }\nKey {}\nBody { Core(){ N:Chip(angle=A){ } } }\n', new KeyState(new EventTarget()), { bare: true });
    try {
      await sim.start();
      sim.step();
      const api = sim.api();
      expect(api._GET(1, 'ANGLE')).toBe(30);
      expect(sim.apiValue('_GET', 1, 'ANGLE')).toBe(30);
      expect(api._X(0)).toBe(sim.apiValue('_X', 0));
      expect(api._TICKS()).toBe(1);
    } finally { await sim.dispose(); }
  }, 20000);
});
