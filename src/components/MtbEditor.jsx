import { useState } from 'react';
import { Check, Plus, Redo2, Trash2, Undo2, Upload, X } from 'lucide-react';
import AppleMap from './AppleMap.jsx';
import { MTB_ACCESS, MTB_ACCESS_LABELS, MTB_DIFFICULTY, MTB_DIRECTION, geometryDistance } from '../lib/mtb.js';
import { parseGpx, validateGpx } from '../lib/gpx.js';
import { addVertex, deleteVertex, emptyEditor, moveVertex, redo, undo } from '../lib/mtbEditor.js';

const DIFFICULTY_LABELS = { green: 'Green', blue: 'Blue', black: 'Black', double_black: 'Double black', unknown: 'Unknown' };
const DIRECTION_LABELS = { uphill: 'Uphill', downhill: 'Downhill', both: 'Both directions' };

function fmtDistance(meters) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

// Interactive trail/segment drawing. Points are added by tapping a map picker; the
// vertex list supports move, delete, undo and redo. Drawing a straight line between
// widely separated points is authored geometry, never proof a trail exists.
export default function MtbEditor({ kind, onCancel, onSave, saving }) {
  const [state, setState] = useState(emptyEditor());
  const [picking, setPicking] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [difficulty, setDifficulty] = useState('unknown');
  const [access, setAccess] = useState('unknown');
  const [direction, setDirection] = useState('both');
  const [error, setError] = useState('');

  const meters = state.vertices.length >= 2 ? geometryDistance(state.vertices) : 0;

  if (picking !== false) {
    return (
      <section className="mtb-editor">
        <header className="mtb-editor-head">
          <h2>{typeof picking === 'number' ? 'Move point' : 'Place a point'}</h2>
          <button type="button" className="icon-button" aria-label="Cancel" onClick={() => setPicking(false)}><X size={20} /></button>
        </header>
        <p className="muted small-copy">Tap the map to {typeof picking === 'number' ? 'move this point' : 'drop the next point'}.</p>
        <AppleMap picker payload={{ routes: [], pins: [] }} onResult={result => {
          if (Number.isFinite(result?.latitude) && Number.isFinite(result?.longitude)) {
            const point = [result.latitude, result.longitude];
            setState(prev => (typeof picking === 'number' ? moveVertex(prev, picking, point) : addVertex(prev, point)));
          }
          setPicking(false);
        }} />
      </section>
    );
  }

  async function submit() {
    setError('');
    if (!name.trim()) { setError('Add a name before saving.'); return; }
    if (state.vertices.length < 2) { setError('Place at least two points.'); return; }
    try {
      await onSave({ name: name.trim(), description, difficulty, access, direction, geometry: state.vertices, distanceMeters: meters });
    } catch (e) { setError(e.message || 'Could not save.'); }
  }

  async function importGpx(file) {
    setError('');
    try {
      const text = await file.text();
      const { name: gpxName, points } = parseGpx(text);
      const check = validateGpx(points);
      if (!check.ok) { setError(check.reason); return; }
      setState({ vertices: points, undoStack: [], redoStack: [] });
      if (!name.trim() && gpxName) setName(gpxName);
    } catch { setError('That file could not be read as a GPX track.'); }
  }

  return (
    <section className="mtb-editor">
      <header className="mtb-editor-head">
        <h2>{kind === 'trail' ? 'New trail' : 'New segment'}</h2>
        <button type="button" className="icon-button" aria-label="Close editor" onClick={onCancel}><X size={20} /></button>
      </header>

      <p className="muted small-copy">Tap points on the map to trace the {kind === 'trail' ? 'trail' : 'segment'}. Unmapped singletrack is fine — the path need not exist in any base map.</p>

      <div className="mtb-toolbar">
        <button type="button" className="secondary" onClick={() => setPicking(true)}><Plus size={16} /> Add point</button>
        <button type="button" className="secondary" disabled={!state.undoStack.length} aria-label="Undo" onClick={() => setState(s => undo(s))}><Undo2 size={16} /></button>
        <button type="button" className="secondary" disabled={!state.redoStack.length} aria-label="Redo" onClick={() => setState(s => redo(s))}><Redo2 size={16} /></button>
        <label className="secondary mtb-import">
          <Upload size={16} /> Import GPX
          <input type="file" accept=".gpx,application/gpx+xml,application/xml" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void importGpx(f); e.target.value = ''; }} />
        </label>
      </div>

      {state.vertices.length >= 2 && (
        <AppleMap large payload={{ routes: [state.vertices], pins: [{ point: state.vertices[0], title: 'Start', kind: 'start' }, { point: state.vertices.at(-1), title: 'Finish', kind: 'finish' }] }} />
      )}

      <p className="muted small-copy" role="status">{state.vertices.length} point{state.vertices.length === 1 ? '' : 's'} · {fmtDistance(meters)}</p>

      {state.vertices.length > 0 && (
        <ol className="mtb-vertex-list">
          {state.vertices.map((v, i) => (
            <li key={i}>
              <span>{i === 0 ? 'Start' : i === state.vertices.length - 1 ? 'Finish' : `Point ${i}`} · {v[0].toFixed(5)}, {v[1].toFixed(5)}</span>
              <button type="button" className="icon-button" aria-label={`Move point ${i}`} onClick={() => { setPicking(i); }}>Move</button>
              <button type="button" className="icon-button" aria-label={`Delete point ${i}`} onClick={() => setState(s => deleteVertex(s, i))}><Trash2 size={16} /></button>
            </li>
          ))}
        </ol>
      )}

      <label>Name<input aria-label="Name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Ridge singletrack" /></label>
      <label>Description<input value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional" /></label>
      <div className="mtb-form-row">
        <label>Difficulty<select aria-label="Difficulty" value={difficulty} onChange={e => setDifficulty(e.target.value)}>{MTB_DIFFICULTY.map(d => <option key={d} value={d}>{DIFFICULTY_LABELS[d]}</option>)}</select></label>
        <label>Direction<select aria-label="Direction" value={direction} onChange={e => setDirection(e.target.value)}>{MTB_DIRECTION.map(d => <option key={d} value={d}>{DIRECTION_LABELS[d]}</option>)}</select></label>
      </div>
      <label>Access<select aria-label="Access" value={access} onChange={e => setAccess(e.target.value)}>{MTB_ACCESS.map(a => <option key={a} value={a}>{MTB_ACCESS_LABELS[a]}</option>)}</select></label>

      {error && <p role="alert" className="error">{error}</p>}

      <div className="mtb-actions">
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary" disabled={saving} onClick={submit}>{saving ? 'Saving…' : 'Save draft'}<Check size={16} /></button>
      </div>
    </section>
  );
}
