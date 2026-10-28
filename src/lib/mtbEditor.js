import { geometryDistance } from './mtb.js';

// Interactive trail/segment drawing state. Pure and immutable: every action returns
// a new editor object so undo/redo and tests stay deterministic.
export const emptyEditor = () => ({ vertices: [], undoStack: [], redoStack: [] });

function commit(editor, vertices) {
  return { vertices, undoStack: [...editor.undoStack, editor.vertices], redoStack: [] };
}

export function addVertex(editor, point) { return commit(editor, [...editor.vertices, point]); }
export function moveVertex(editor, index, point) {
  if (index < 0 || index >= editor.vertices.length) return editor;
  const next = editor.vertices.slice(); next[index] = point;
  return commit(editor, next);
}
export function insertVertex(editor, index, point) {
  if (index < 0 || index > editor.vertices.length) return editor;
  const next = editor.vertices.slice(); next.splice(index, 0, point);
  return commit(editor, next);
}
export function deleteVertex(editor, index) {
  if (editor.vertices.length <= 2 || index < 0 || index >= editor.vertices.length) return editor;
  const next = editor.vertices.slice(); next.splice(index, 1);
  return commit(editor, next);
}
export function undo(editor) {
  if (!editor.undoStack.length) return editor;
  return { vertices: editor.undoStack.at(-1), undoStack: editor.undoStack.slice(0, -1), redoStack: [editor.vertices, ...editor.redoStack] };
}
export function redo(editor) {
  if (!editor.redoStack.length) return editor;
  return { vertices: editor.redoStack[0], undoStack: [...editor.undoStack, editor.vertices], redoStack: editor.redoStack.slice(1) };
}
export const editorDistance = editor => geometryDistance(editor.vertices);
export const canFinish = editor => editor.vertices.length >= 2;
