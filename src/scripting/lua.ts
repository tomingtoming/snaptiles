import { LuaEventMasks, LuaFactory, LuaLibraries, LuaType, type LuaEngine } from 'wasmoon';
import wasmoonWasmUrl from 'wasmoon/dist/glue.wasm?url';

const nodeWasmPath = (): string => {
  const path = new URL('../../node_modules/wasmoon/dist/glue.wasm', import.meta.url).pathname;
  return decodeURIComponent(path).replace(/^\/([A-Za-z]:\/)/, '$1');
};
const runtimeWasmUrl = (): string => (typeof window === 'undefined' ? nodeWasmPath() : wasmoonWasmUrl);

const SAFE_LIBRARIES = [LuaLibraries.Base, LuaLibraries.Table, LuaLibraries.String, LuaLibraries.UTF8, LuaLibraries.Math] as const;

export type LuaApi = Record<string, (...args: number[]) => number | string | undefined>;

// Lua 5.0-era names that community scripts rely on, mapped onto 5.4.
const COMPAT = `
math.mod = math.fmod
math.pow = function(a, b) return a ^ b end
string.gfind = string.gmatch
table.getn = function(t) return #t end
table.setn = function() end
unpack = table.unpack
loadstring = load
dofile = nil; loadfile = nil; require = nil; collectgarbage = nil
`;

/**
 * Runs the model's Lua block: OnInit / OnReset / OnFrame (or main) with an
 * instruction budget per call so a runaway loop can't freeze the page.
 */
export class ScriptRunner {
  private factory = new LuaFactory(runtimeWasmUrl());
  private lua: LuaEngine | null = null;
  private hookPtr: number | null = null;
  private remaining = 0;
  error: string | null = null;
  outLines: string[] = [];
  maxInstructionsPerCall = 500_000;
  private frameFn: 'OnFrame' | 'main' | null = null;

  async load(source: string, api: LuaApi, prelude = ''): Promise<void> {
    await this.dispose();
    const lua = await this.factory.createEngine({ openStandardLibs: false, injectObjects: false, enableProxy: false });
    for (const lib of SAFE_LIBRARIES) lua.global.loadLibrary(lib);
    for (const [name, fn] of Object.entries(api)) lua.global.set(name, fn);
    lua.global.set('print', (...args: unknown[]) => this.print(0, args));
    lua.global.set('out', (row: number, ...args: unknown[]) => this.print(row, args));
    this.lua = lua;
    this.error = null;
    this.outLines = [];
    try {
      await lua.doString(COMPAT);
      if (prelude) await lua.doString(prelude);
      this.armBudget();
      await lua.doString(source);
      this.disarmBudget();
      const g = lua.global;
      const isFn = (name: string) => {
        const t = g.lua.lua_getglobal(g.address, name);
        g.lua.lua_settop(g.address, 0);
        return t === LuaType.Function;
      };
      this.frameFn = isFn('OnFrame') ? 'OnFrame' : isFn('main') ? 'main' : null;
    } catch (e) {
      this.disarmBudget();
      this.error = formatError(e);
    }
  }

  private print(row: number, args: unknown[]): void {
    const text = args
      .map((a) => (typeof a === 'number' ? (Number.isInteger(a) ? String(a) : a.toFixed(2)) : String(a)))
      .join(' ');
    const r = Math.max(0, Math.min(24, Math.floor(row)));
    while (this.outLines.length <= r) this.outLines.push('');
    this.outLines[r] = text;
  }

  setNumber(name: string, v: number): void {
    this.lua?.global.set(name, v);
  }
  getNumber(name: string): number | undefined {
    const v = this.lua?.global.get(name);
    return typeof v === 'number' ? v : undefined;
  }

  /** Run the per-frame function. Returns false if the script errored (and is now disabled). */
  frame(): boolean {
    if (!this.frameFn) return !this.error;
    return this.call(this.frameFn);
  }

  call(fnName: string): boolean {
    const lua = this.lua;
    if (!lua || this.error) return false;
    const g = lua.global;
    const L = g.address;
    if (g.lua.lua_getglobal(L, fnName) !== LuaType.Function) {
      g.lua.lua_settop(L, 0);
      return true;
    }
    this.armBudget();
    try {
      const r = g.lua.lua_pcallk(L, 0, 0, 0, 0, null);
      if (r !== 0) {
        const msg = g.lua.lua_tolstring(L, -1, null);
        g.lua.lua_settop(L, 0);
        this.error = `${fnName}: ${String(msg ?? 'error')}`;
        return false;
      }
      g.lua.lua_settop(L, 0);
      return true;
    } catch (e) {
      this.error = formatError(e);
      return false;
    } finally {
      this.disarmBudget();
    }
  }

  private armBudget(): void {
    const lua = this.lua!;
    const g = lua.global;
    const budget = Math.max(1, Math.floor(this.maxInstructionsPerCall));
    const quantum = 1000;
    this.remaining = budget;
    if (this.hookPtr === null) {
      this.hookPtr = g.lua.module.addFunction((L: number) => {
        this.remaining -= quantum;
        if (this.remaining <= 0) {
          g.lua.lua_pushstring(L, 'instruction budget exceeded');
          g.lua.lua_error(L);
        }
      }, 'vii');
    }
    g.lua.lua_sethook(g.address, this.hookPtr, LuaEventMasks.Count, quantum);
  }

  private disarmBudget(): void {
    const lua = this.lua;
    if (!lua || this.hookPtr === null) return;
    lua.global.lua.lua_sethook(lua.global.address, null, 0, 0);
  }

  async dispose(): Promise<void> {
    if (this.lua) {
      try {
        this.disarmBudget();
        if (this.hookPtr !== null) {
          this.lua.global.lua.module.removeFunction(this.hookPtr);
          this.hookPtr = null;
        }
        this.lua.global.close();
      } catch {
        /* ignore */
      }
      this.lua = null;
    }
    this.frameFn = null;
  }
}

function formatError(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
