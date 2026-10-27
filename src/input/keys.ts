// Key numbers used by the Key section of .rc files, mapped to keyboard events.
// The numbering follows the public documentation (see docs/spec/rc-format.md);
// keep this table the single source of truth.

export interface KeyDef {
  code: string; // KeyboardEvent.code
  glyph: string; // how the keycap is drawn
}

export const KEY_TABLE: KeyDef[] = [
  { code: 'ArrowLeft', glyph: '←' },
  { code: 'ArrowUp', glyph: '↑' },
  { code: 'ArrowRight', glyph: '→' },
  { code: 'ArrowDown', glyph: '↓' },
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

  constructor(private target: HTMLElement | Window = window) {
    KEY_TABLE.forEach((k, i) => this.byCode.set(k.code, i));
    this.target.addEventListener('keydown', this.onDown as EventListener);
    this.target.addEventListener('keyup', this.onUp as EventListener);
    window.addEventListener('blur', () => this.down.clear());
  }

  private onDown = (e: KeyboardEvent) => {
    if (isTyping(e)) return;
    const n = this.byCode.get(e.code);
    if (n === undefined) return;
    this.down.add(n);
    e.preventDefault();
  };
  private onUp = (e: KeyboardEvent) => {
    const n = this.byCode.get(e.code);
    if (n === undefined) return;
    this.down.delete(n);
  };

  isDown(n: number): boolean {
    return this.down.has(n);
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
