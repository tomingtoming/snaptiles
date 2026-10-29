// Procedural sound effects (no audio assets): engine hum from wheel spin, jet roar from
// thrust, a "pew" when an Arm fires, a thud on hard impacts. Everything is synthesized
// with the Web Audio API and starts on the first user gesture (autoplay policy).

export class Sfx {
  private Audio = globalThis.AudioContext ?? (globalThis as typeof globalThis & {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
  private failed = false;
  get available(): boolean { return typeof this.Audio === 'function' && !this.failed; }
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engineOsc!: OscillatorNode;
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private jetGain!: GainNode;
  private jetFilter!: BiquadFilterNode;
  private noise!: AudioBufferSourceNode;
  private armed = false;
  muted = false;
  constructor() {
    try { this.muted = localStorage.getItem('snaptiles.muted') === '1'; } catch { /* optional preference storage */ }
  }

  /** call from a pointerdown / keydown handler */
  unlock(): void {
    if (!this.available) return;
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        try { void this.ctx.resume().catch(() => {}); } catch { /* retry on a later gesture */ }
      }
      return;
    }
    let ctx: AudioContext | null = null;
    try {
      ctx = new this.Audio!();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(ctx.destination);

      // engine: a sawtooth through a low-pass, pitch follows wheel speed
      this.engineOsc = ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 40;
      this.engineFilter = ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 400;
      this.engineGain = ctx.createGain();
      this.engineGain.gain.value = 0;
      this.engineOsc.connect(this.engineFilter).connect(this.engineGain).connect(this.master);
      this.engineOsc.start();

      // jet: looped white noise through a band-pass
      const seconds = 2;
      const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noise = ctx.createBufferSource();
      this.noise.buffer = buf;
      this.noise.loop = true;
      this.jetFilter = ctx.createBiquadFilter();
      this.jetFilter.type = 'bandpass';
      this.jetFilter.frequency.value = 600;
      this.jetFilter.Q.value = 0.7;
      this.jetGain = ctx.createGain();
      this.jetGain.gain.value = 0;
      this.noise.connect(this.jetFilter).connect(this.jetGain).connect(this.master);
      this.noise.start();
      this.armed = true;
    } catch {
      this.failed = true; this.armed = false; this.ctx = null;
      try { void ctx?.close().catch(() => {}); } catch { /* already unavailable */ }
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    try { localStorage.setItem('snaptiles.muted', m ? '1' : '0'); } catch { /* keep this session's setting */ }
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.05);
  }

  /** per frame: wheelSpin = fastest wheel in rad/s, jetPower = sum of |power| */
  update(wheelSpin: number, jetPower: number): void {
    if (!this.armed || !this.ctx) return;
    const t = this.ctx.currentTime;
    const spin = Math.min(1, wheelSpin / 120);
    this.engineOsc.frequency.setTargetAtTime(40 + 220 * spin, t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(300 + 1500 * spin, t, 0.08);
    this.engineGain.gain.setTargetAtTime(spin > 0.02 ? 0.12 + 0.18 * spin : 0, t, 0.1);
    const jet = Math.min(1, jetPower / 80000);
    this.jetFilter.frequency.setTargetAtTime(400 + 2600 * jet, t, 0.1);
    this.jetGain.gain.setTargetAtTime(jet > 0.01 ? 0.05 + 0.35 * jet : 0, t, 0.12);
  }

  /** Arm shot: a quick downward chirp plus a noise tick */
  fire(): void {
    if (!this.armed || !this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(900, t);
    osc.frequency.exponentialRampToValueAtTime(120, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.22);
  }

  /** impact: low noise burst, louder with intensity (0..1) */
  thud(intensity: number): void {
    if (!this.armed || !this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise.buffer;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(500, t);
    f.frequency.exponentialRampToValueAtTime(80, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.1 + 0.5 * Math.min(1, intensity), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.32);
  }
}
