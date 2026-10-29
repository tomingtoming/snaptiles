export interface Draft { version: 1; text: string; savedAt: number }
export class DraftStore {
  constructor(private storage: Pick<Storage, 'getItem' | 'setItem'>, private key = 'snaptiles.editor.draft.v1') {}
  read(): Draft | null {
    try {
      const value = JSON.parse(this.storage.getItem(this.key) ?? 'null');
      return value?.version === 1 && typeof value.text === 'string' && typeof value.savedAt === 'number' ? value : null;
    } catch { return null; }
  }
  save(text: string): boolean {
    try { this.storage.setItem(this.key, JSON.stringify({version: 1, text, savedAt: Date.now()})); return true; }
    catch { return false; }
  }
}
