export interface Draft { version: 1; text: string; filename?: string; savedAt: number }
export class DraftStore {
  constructor(private storage: Pick<Storage, 'getItem' | 'setItem'>, private key = 'snaptiles.editor.draft.v1') {}
  read(): Draft | null {
    try {
      const value = JSON.parse(this.storage.getItem(this.key) ?? 'null');
      return value?.version === 1 && typeof value.text === 'string' && typeof value.savedAt === 'number' ? {...value, filename: typeof value.filename === 'string' ? value.filename : undefined} : null;
    } catch { return null; }
  }
  save(text: string, filename?: string): boolean {
    try { this.storage.setItem(this.key, JSON.stringify({version: 1, text, filename, savedAt: Date.now()})); return true; }
    catch { return false; }
  }
}
