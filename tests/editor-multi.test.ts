import { describe, it, expect } from 'vitest';
import { ModelDocument } from '../src/editor/document';

const MODEL = `Val { A(default=10) }
Body { Core(){
  N:Chip(angle=5){ N:Frame(){ } }
  W:Chip(){ }
  E:Rudder(angle=A, color=#112233){ }
  S:Chip(angle=-20){ S:Chip(){ } }
} }
Lua { function main() end }`;
// traversal: 0 Core, 1 N:Chip, 2 N:Frame, 3 W:Chip, 4 E:Rudder, 5 S:Chip, 6 S:Chip
const offsetOf = (d: ModelDocument, i: number) => d.nodes()[i].source!.start;

describe('multi-selection in the builder', () => {
  it('toggles parts in and out, the toggled-in part becoming the primary one', () => {
    const d = new ModelDocument(MODEL);
    d.selectedOffset = offsetOf(d, 1);
    d.toggleSelected(3);
    d.toggleSelected(5);
    expect(d.selection()).toEqual([5, 1, 3]);
    d.toggleSelected(5);
    expect(d.selection()).toEqual([1, 3]);
    d.toggleSelected(1); d.toggleSelected(3); // the last part cannot be toggled out
    expect(d.selection()).toEqual([3]);
  });

  it('changes type, angle and colour of every selected part in one undoable step', () => {
    const d = new ModelDocument(MODEL);
    d.selectedOffset = offsetOf(d, 1); d.toggleSelected(3); d.toggleSelected(6);
    const before = d.text, all = d.selection();
    d.typeMany(all, 'Frame');
    expect(d.nodes().map(n => n.type)).toEqual(['Core', 'Frame', 'Frame', 'Frame', 'Rudder', 'Chip', 'Frame']);
    expect(d.undoStack).toHaveLength(1);
    expect(d.selection()).toEqual(all); // same topology keeps the selection
    d.angleMany(d.selection(), 30);
    d.colorMany(d.selection(), '#ABCDEF');
    const nodes = d.nodes();
    for (const i of [1, 3, 6]) { expect(nodes[i].attrs.angle).toBe('30'); expect(nodes[i].attrs.color).toBe('#abcdef'); }
    expect(nodes[5].attrs.angle.replace(/\s/g, '')).toBe('-20');
    expect(d.text).toContain('Lua { function main() end }');
    d.undo(); d.undo(); d.undo();
    expect(d.text).toBe(before);
    expect(d.selection()).toEqual(all);
  });

  it('refuses parts it cannot change, without editing anything', () => {
    const d = new ModelDocument(MODEL);
    const before = d.text;
    expect(() => d.angleMany([1, 4], 0)).toThrow(/変数/);
    expect(() => d.typeMany([0, 1], 'Chip')).toThrow(/Core/);
    expect(() => d.removeMany([0, 1])).toThrow(/Core/);
    expect(d.text).toBe(before);
    expect(d.undoStack).toHaveLength(0);
  });

  it('deletes several branches at once, a part inside another selected branch going with it', () => {
    const d = new ModelDocument(MODEL);
    d.removeMany([2, 1, 5, 6]);
    expect(d.nodes().map(n => `${n.dir ?? ''}:${n.type}`)).toEqual([':Core', 'W:Chip', 'E:Rudder']);
    expect(d.undoStack).toHaveLength(1);
    d.undo();
    expect(d.text).toBe(MODEL);
  });

  it('follows the selection through source typing and drops a part whose declaration was rewritten', () => {
    const d = new ModelDocument(MODEL);
    d.selectedOffset = offsetOf(d, 3); d.toggleSelected(6);
    d.editSource('// header\n' + d.text);
    expect(d.selection()).toEqual([6, 3]);
    const w = offsetOf(d, 3);
    d.editSource(d.text.slice(0, w) + 'S' + d.text.slice(w + 1)); // the declaration itself is retyped
    expect(d.selection()).toEqual([6]);
  });
});
