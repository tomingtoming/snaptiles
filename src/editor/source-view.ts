// The source editor's view layer: line numbers (click one to toggle a breakpoint), breakpoint and error marks, and
// syntax colours. The textarea stays the editor (selection, Undo, Tab, probes): its text is transparent and a
// highlighted copy is drawn under it, kept in step on every animation frame (the text also changes from code).
import { findBlocks } from '../rc/parser';

export interface SourceMarks {
  breakpoints(): number[];
  toggleBreakpoint(line: number): void;
  /** file lines with an error (the last run's, or the live syntax check's) */
  errorLines(): number[];
  /** line → message, shown as the gutter mark's tooltip */
  errorMessage(line: number): string | undefined;
}

const LUA_KEYWORDS = new Set(['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while']);
const LUA_LIBS = new Set(['math', 'string', 'table', 'utf8', 'print', 'out', 'pairs', 'ipairs', 'tostring', 'tonumber', 'type', 'next', 'select', 'pcall', 'error', 'unpack', 'setmetatable', 'getmetatable', 'rawget', 'rawset', 'assert']);
const RC_BLOCKS = new Set(['val', 'key', 'body', 'lua', 'script']);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const span = (cls: string, s: string) => `<span class="hl-${cls}">${esc(s)}</span>`;

/** Lua: comments, strings, numbers, keywords, the script API (_NAME), library names */
export function highlightLua(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    let m: RegExpMatchArray | null;
    if ((m = rest.match(/^--\[(=*)\[[\s\S]*?\]\1\]/)) || (m = rest.match(/^--[^\n]*/))) { out += span('comment', m[0]); i += m[0].length; continue; }
    if ((m = rest.match(/^\[(=*)\[[\s\S]*?\]\1\]/)) || (m = rest.match(/^"(?:\\.|[^"\\\n])*"?/)) || (m = rest.match(/^'(?:\\.|[^'\\\n])*'?/))) { out += span('string', m[0]); i += m[0].length; continue; }
    if ((m = rest.match(/^(?:0[xX][0-9a-fA-F]+|\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)/))) { out += span('number', m[0]); i += m[0].length; continue; }
    if ((m = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/))) {
      const w = m[0];
      out += LUA_KEYWORDS.has(w) ? span('keyword', w) : w.startsWith('_') && /^_[A-Z0-9]+$/.test(w) ? span('api', w) : LUA_LIBS.has(w) ? span('lib', w) : esc(w);
      i += w.length;
      continue;
    }
    out += esc(src[i]);
    i++;
  }
  return out;
}

/** the .rc parts: // comments, section names, part types (Name( after a direction), attribute names, numbers */
function highlightRc(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    let m: RegExpMatchArray | null;
    if ((m = rest.match(/^\/\/[^\n]*/))) { out += span('comment', m[0]); i += m[0].length; continue; }
    if ((m = rest.match(/^"[^"\n]*"?/))) { out += span('string', m[0]); i += m[0].length; continue; }
    if ((m = rest.match(/^-?(?:#[0-9a-fA-F]{6}|\d+\.?\d*)/))) { out += span('number', m[0]); i += m[0].length; continue; }
    if ((m = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/))) {
      const w = m[0], after = src.slice(i + w.length).match(/^\s*(.)/)?.[1];
      out += RC_BLOCKS.has(w.toLowerCase()) && after === '{' ? span('keyword', w) : after === '(' ? span('type', w) : after === '=' ? span('attr', w) : esc(w);
      i += w.length;
      continue;
    }
    out += esc(src[i]);
    i++;
  }
  return out;
}

/** the whole source: the Lua section with Lua colours, the rest with .rc colours */
export function highlightSource(text: string): string {
  let lua: { start: number; end: number } | null = null;
  try {
    const b = findBlocks(text).find((x) => /^lua$/i.test(x.name));
    if (b) lua = { start: b.offset, end: b.offset + b.inner.length };
  } catch { /* an unclosed section: colour as .rc */ }
  if (!lua) return highlightRc(text);
  return highlightRc(text.slice(0, lua.start)) + highlightLua(text.slice(lua.start, lua.end)) + highlightRc(text.slice(lua.end));
}

export class SourceView {
  readonly wrap: HTMLElement;
  /** the textarea's positioned box (the completion popup lives here) */
  readonly layer: HTMLElement;
  private gutter: HTMLElement;
  private code: HTMLElement;
  private shown = { text: '', lines: -1, marks: '', top: -1, left: -1 };

  constructor(private textarea: HTMLTextAreaElement, private marks: SourceMarks) {
    this.wrap = document.createElement('div');
    this.wrap.id = 'source-wrap';
    this.gutter = document.createElement('div');
    this.gutter.id = 'source-gutter';
    this.gutter.setAttribute('aria-label', '行番号（押すとブレークポイントを切り替え）');
    const layer = document.createElement('div');
    layer.className = 'source-layer';
    this.layer = layer;
    this.code = document.createElement('pre');
    this.code.id = 'source-highlight';
    this.code.setAttribute('aria-hidden', 'true');
    textarea.replaceWith(this.wrap);
    layer.append(this.code, textarea);
    this.wrap.append(this.gutter, layer);
    this.gutter.addEventListener('click', (e) => {
      const line = Number((e.target as HTMLElement).closest<HTMLElement>('[data-line]')?.dataset.line);
      if (line) this.marks.toggleBreakpoint(line);
    });
    textarea.addEventListener('scroll', () => this.sync());
    const tick = () => { this.refresh(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }

  /** redraw what changed: the colours (text), the gutter (line count, marks), the scroll position */
  refresh(): void {
    const text = this.textarea.value;
    if (text !== this.shown.text) {
      this.shown.text = text;
      // a trailing newline needs a character after it to take up a line in the <pre>
      this.code.innerHTML = highlightSource(text) + '\n';
    }
    const lines = text.split('\n').length;
    const bps = this.marks.breakpoints(), errs = this.marks.errorLines();
    const marks = `${bps.join(',')}|${errs.join(',')}`;
    if (lines !== this.shown.lines || marks !== this.shown.marks) {
      this.shown.lines = lines;
      this.shown.marks = marks;
      const rows: string[] = [];
      for (let n = 1; n <= lines; n++) {
        const cls = [bps.includes(n) ? 'bp' : '', errs.includes(n) ? 'err' : ''].filter(Boolean).join(' ');
        const title = errs.includes(n) ? ` title="${esc(this.marks.errorMessage(n) ?? 'エラー')}"` : '';
        rows.push(`<div data-line="${n}"${cls ? ` class="${cls}"` : ''}${title}>${n}</div>`);
      }
      this.gutter.innerHTML = rows.join('');
    }
    this.sync();
  }

  private sync(): void {
    const { scrollTop, scrollLeft } = this.textarea;
    if (scrollTop !== this.shown.top || scrollLeft !== this.shown.left) {
      this.shown.top = scrollTop;
      this.shown.left = scrollLeft;
      this.code.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`;
      this.gutter.scrollTop = scrollTop;
    }
  }
}
