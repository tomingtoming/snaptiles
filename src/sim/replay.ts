// A run as its inputs: what the page handed the core before every step (held keys, pointer, view size, gamepad
// axes) and the page's commands (reset, a ball, the wind). The core repeats a run exactly from the same inputs
// (core/README.md), so a recording replays a run, rewinds it (re-run to any frame) and travels in a share link.
// Encoded as the changes of each field only, then deflate-raw and base64url.

export interface FrameInput {
  keys: number;
  mx: number;
  my: number;
  ml: number;
  mr: number;
  mm: number;
  width: number;
  height: number;
  axes: number[];
}

export type Command =
  | { frame: number; kind: 'reset' }
  | { frame: number; kind: 'ball'; args: [number, number, number, number, number] }
  | { frame: number; kind: 'wind'; args: [number, number, number] };

export class Recording {
  inputs: FrameInput[] = [];
  commands: Command[] = [];

  get frames(): number {
    return this.inputs.length;
  }

  /** a copy holding frames [0, frame) and the commands issued before frame `frame` */
  slice(frame: number): Recording {
    const r = new Recording();
    r.inputs = this.inputs.slice(0, frame);
    r.commands = this.commands.filter((c) => c.frame < frame);
    return r;
  }

  commandsAt(frame: number): Command[] {
    return this.commands.filter((c) => c.frame === frame);
  }
}

const sameInput = (a: FrameInput, b: FrameInput) =>
  a.keys === b.keys && a.mx === b.mx && a.my === b.my && a.ml === b.ml && a.mr === b.mr && a.mm === b.mm &&
  a.width === b.width && a.height === b.height && a.axes.every((x, i) => x === b.axes[i]);

interface Packed {
  v: 1;
  n: number;
  /** [frame, keys, mx, my, ml, mr, mm, width, height, ...axes] whenever any of them changes */
  i: number[][];
  c: (number | string)[][];
}

export function pack(r: Recording): Packed {
  const i: number[][] = [];
  let prev: FrameInput | null = null;
  r.inputs.forEach((x, f) => {
    if (!prev || !sameInput(prev, x)) i.push([f, x.keys, x.mx, x.my, x.ml, x.mr, x.mm, x.width, x.height, ...x.axes]);
    prev = x;
  });
  const c = r.commands.map((cmd) => cmd.kind === 'reset' ? [cmd.frame, 'r'] : [cmd.frame, cmd.kind === 'ball' ? 'b' : 'w', ...cmd.args]);
  return { v: 1, n: r.frames, i, c };
}

export function unpack(p: Packed): Recording {
  if (p.v !== 1 || !Array.isArray(p.i)) throw new Error('unknown recording format');
  const r = new Recording();
  let row = 0;
  let cur: FrameInput = { keys: 0, mx: 0, my: 0, ml: 0, mr: 0, mm: 0, width: 640, height: 480, axes: [0, 0, 0, 0, 0, 0] };
  for (let f = 0; f < p.n; f++) {
    while (row < p.i.length && p.i[row][0] === f) {
      const [, keys, mx, my, ml, mr, mm, width, height, ...axes] = p.i[row++];
      cur = { keys, mx, my, ml, mr, mm, width, height, axes };
    }
    r.inputs.push(cur);
  }
  for (const [frame, kind, ...args] of p.c) {
    const f = Number(frame), a = args.map(Number);
    if (kind === 'r') r.commands.push({ frame: f, kind: 'reset' });
    else if (kind === 'b') r.commands.push({ frame: f, kind: 'ball', args: [a[0], a[1], a[2], a[3], a[4]] });
    else if (kind === 'w') r.commands.push({ frame: f, kind: 'wind', args: [a[0], a[1], a[2]] });
  }
  return r;
}

/** deflate-raw + base64url of UTF-8 text (model sources and recordings in share links) */
export async function encodeText(text: string): Promise<string> {
  const cs = new CompressionStream('deflate-raw');
  const w = cs.writable.getWriter();
  void w.write(new TextEncoder().encode(text));
  void w.close();
  const bytes = new Uint8Array(await new Response(cs.readable).arrayBuffer());
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function decodeText(h: string): Promise<string> {
  const b64 = h.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const ds = new DecompressionStream('deflate-raw');
  const w = ds.writable.getWriter();
  void w.write(bytes);
  void w.close();
  return new TextDecoder().decode(await new Response(ds.readable).arrayBuffer());
}

export async function encodeRecording(r: Recording): Promise<string> {
  return encodeText(JSON.stringify(pack(r)));
}

export async function decodeRecording(s: string): Promise<Recording> {
  return unpack(JSON.parse(await decodeText(s)) as Packed);
}
