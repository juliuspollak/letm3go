import { describe, expect, it } from 'vitest';
import { addVertex, canFinish, deleteVertex, editorDistance, emptyEditor, insertVertex, moveVertex, redo, undo } from './mtbEditor.js';

describe('editor', () => {
  it('adds, inserts, moves and deletes vertices', () => {
    let e = emptyEditor();
    e = addVertex(e, [-33, 151]);
    e = addVertex(e, [-33.001, 151.001]);
    e = addVertex(e, [-33.002, 151.002]);
    expect(e.vertices).toHaveLength(3);
    e = insertVertex(e, 1, [-33.0005, 151.0005]);
    expect(e.vertices).toHaveLength(4);
    expect(e.vertices[1]).toEqual([-33.0005, 151.0005]);
    e = moveVertex(e, 1, [-33.0006, 151.0006]);
    expect(e.vertices[1]).toEqual([-33.0006, 151.0006]);
    e = deleteVertex(e, 1);
    expect(e.vertices).toHaveLength(3);
  });
  it('undoes and redoes deterministically', () => {
    let e = emptyEditor();
    e = addVertex(e, [-33, 151]);
    e = addVertex(e, [-33.001, 151.001]);
    e = addVertex(e, [-33.002, 151.002]);
    const three = e.vertices;
    e = undo(e);
    expect(e.vertices).toHaveLength(2);
    e = undo(e);
    expect(e.vertices).toHaveLength(1);
    e = redo(e);
    expect(e.vertices).toHaveLength(2);
    e = redo(e);
    expect(e.vertices).toEqual(three);
  });
  it('never drops below two vertices and reports distance', () => {
    let e = emptyEditor();
    e = addVertex(e, [-33, 151]);
    e = addVertex(e, [-33.001, 151]);
    expect(deleteVertex(e, 0).vertices).toHaveLength(2);
    expect(canFinish(e)).toBe(true);
    expect(editorDistance(e)).toBeGreaterThan(100);
  });
});
