import { describe, expect, it } from 'vitest';
import { RustSimulation } from '../src/sim/rust-simulation';
import { KeyState } from '../src/input/keys';
import { decodeRecording, encodeRecording } from '../src/sim/replay';
import { SAMPLES } from '../src/samples';

// A recorded run replays exactly: the same poses, Vals and out() rows every frame, through a share-link round trip,
// with key presses, a reset, a ball and wind among the inputs.
describe('recordings', () => {
  it('replay a run exactly after encoding', async () => {
    const car = SAMPLES.find((s) => s.name === 'car')!.source;
    const keys = new KeyState(new EventTarget());
    const live = new RustSimulation(car, keys, { bare: true });
    const trace: string[] = [];
    const snap = (s: RustSimulation) => JSON.stringify([s.corePosition().toArray(), [...s.vals.values()].map((v) => v.value), s.out]);
    try {
      await live.start();
      for (let f = 0; f < 150; f++) {
        if (f === 5) keys.press(0);
        if (f === 60) { keys.release(0); keys.press(2); }
        if (f === 80) keys.release(2);
        if (f === 90) live.physics.addBall(0.6, 2, 6, 0, 0.3);
        if (f === 100) live.physics.wind.set(16, 0, 0);
        if (f === 120) live.reset();
        live.step();
        trace.push(snap(live));
      }
      const code = await encodeRecording(live.recording);
      expect(code.length).toBeLessThan(400);
      const replay = new RustSimulation(car, new KeyState(new EventTarget()), { bare: true });
      try {
        await replay.start();
        replay.player = await decodeRecording(code);
        for (let f = 0; f < 150; f++) {
          expect(replay.replaying).toBe(true);
          replay.step();
          expect(snap(replay), `frame ${f}`).toBe(trace[f]);
        }
        expect(replay.replaying).toBe(false);
        expect(replay.recording.frames).toBe(150);
      } finally { await replay.dispose(); }
    } finally {
      await live.dispose();
    }
  }, 30000);
});
