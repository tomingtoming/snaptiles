// Key numbers used by the Key section of .rc files, mapped to keyboard events.
// The numbering follows the public documentation (see docs/spec/rc-format.md);
// keep this table the single source of truth.

export interface KeyDef {
  code: string; // KeyboardEvent.code
  glyph: string; // how the keycap is drawn
}

// Arrow order measured on the corpus (bike: 0=engine 1=brake 2/3=steer; tonbo: 0/1=pitch
// 2/3=roll; 3wheel; zrobo "Up/Down: Walk/Stop  </>: Turn"): 0 ↑, 1 ↓, 2 ←, 3 →.
export const KEY_TABLE: KeyDef[] = [
  { code: 'ArrowUp', glyph: '↑' },
  { code: 'ArrowDown', glyph: '↓' },
  { code: 'ArrowLeft', glyph: '←' },
  { code: 'ArrowRight', glyph: '→' },
  { code: 'KeyZ', glyph: 'Z' },
  { code: 'KeyX', glyph: 'X' },
  { code: 'KeyC', glyph: 'C' },
  { code: 'KeyA', glyph: 'A' },
  { code: 'KeyS', glyph: 'S' },
  { code: 'KeyD', glyph: 'D' },
  { code: 'KeyV', glyph: 'V' },
  { code: 'KeyB', glyph: 'B' },
  { code: 'KeyF', glyph: 'F' },
  { code: 'KeyG', glyph: 'G' },
  { code: 'KeyQ', glyph: 'Q' },
  { code: 'KeyW', glyph: 'W' },
  { code: 'KeyE', glyph: 'E' },
];

export class KeyState {
  down = new Set<number>();
  private byCode = new Map<string, number>();
  /** extra physical keys standing in for a key number (WASD for the arrows when the model leaves 7/8/9/15 unused) */
  private aliases = new Map<string, number>();
  /** key numbers held by a gamepad (left stick / d-pad -> 0..3, buttons -> 4..) and its raw axes for _ANALOG */
  private pad = new Set<number>();
  axes: number[] = [0, 0, 0, 0, 0, 0];
  /** pointer over the view (canvas pixels) and its buttons, for _MX/_MY/_ML/_MR/_MM */
  mouse = { x: 0, y: 0, l: 0, r: 0, m: 0 };

  constructor(private target: EventTarget = window) {
    KEY_TABLE.forEach((k, i) => this.byCode.set(k.code, i));
    this.target.addEventListener('keydown', this.onDown as EventListener);
    this.target.addEventListener('keyup', this.onUp as EventListener);
    if (typeof window !== 'undefined') window.addEventListener('blur', () => this.down.clear());
  }

  private onDown = (e: KeyboardEvent) => {
    if (isTyping(e)) return;
    const n = this.aliases.get(e.code) ?? this.byCode.get(e.code);
    if (n === undefined) return;
    this.down.add(n);
    e.preventDefault();
  };
  private onUp = (e: KeyboardEvent) => {
    const n = this.aliases.get(e.code) ?? this.byCode.get(e.code);
    if (n === undefined) return;
    this.down.delete(n);
  };

  /** The original's table (measured 2026-10-28): 0..3 are the arrows and W/A/S/D are their own numbers
   *  15/7/8/9. A model that binds none of those gets WASD as a second way to press the arrows. */
  setWasdAliases(usedNumbers: Iterable<number>): void {
    this.aliases.clear();
    const used = new Set(usedNumbers);
    if ([7, 8, 9, 15].some((n) => used.has(n))) return;
    this.aliases.set('KeyW', 0);
    this.aliases.set('KeyS', 1);
    this.aliases.set('KeyA', 2);
    this.aliases.set('KeyD', 3);
  }

  isDown(n: number): boolean {
    return this.down.has(n) || this.pad.has(n);
  }

  /** poll the first connected gamepad (call once per frame) */
  pollGamepad(): void {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    const gp = [...navigator.getGamepads()].find((g) => g && g.connected);
    this.pad.clear();
    if (!gp) return;
    this.axes = [0, 1, 2, 3, 4, 5].map((i) => gp.axes[i] ?? 0);
    const x = gp.axes[0] ?? 0;
    const y = gp.axes[1] ?? 0;
    if (y < -0.5 || gp.buttons[12]?.pressed) this.pad.add(0);
    if (y > 0.5 || gp.buttons[13]?.pressed) this.pad.add(1);
    if (x < -0.5 || gp.buttons[14]?.pressed) this.pad.add(2);
    if (x > 0.5 || gp.buttons[15]?.pressed) this.pad.add(3);
    // face and shoulder buttons in order -> Z X C A S D V B
    [0, 1, 2, 3, 4, 5, 6, 7].forEach((b, i) => { if (gp.buttons[b]?.pressed) this.pad.add(4 + i); });
  }

  /** on-screen keycaps (touch / mouse) */
  press(n: number): void {
    this.down.add(n);
  }
  release(n: number): void {
    this.down.delete(n);
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'TEXTAREA' || tag === 'INPUT' || t.isContentEditable;
}
