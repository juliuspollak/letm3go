import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, MessageSquare, Mountain, Plus, Route, ShieldAlert, X } from 'lucide-react';
import AppleMap from './AppleMap.jsx';
import MtbEditor from './MtbEditor.jsx';
import { useAuth } from '../lib/AuthContext.jsx';
import { useMtbMap } from '../lib/useMtbMap.js';
import { bboxFromViewport, MTB_ACCESS_LABELS, MTB_STATUS_LABELS, mtbOverlaysToMapPayload, toggleMtbLayer, accessRestricted } from '../lib/mtb.js';
import * as mtbApi from '../lib/mtbApi.js';
import { supabase } from '../lib/supabase.js';

function fmtMeters(m) { return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`; }

// The dedicated MTB map and community workflow. Trails and approved segments are
// rendered over the same Apple Maps view as the rest of the app; a rider can draw
// unmapped singletrack, save a draft and submit it for community approval.
export default function MtbMap({ currentPosition, onRecordTrail }) {
  // The auth context spreads the identity (status, session, preferences) into its value.
  const { status } = useAuth();
  const signedIn = status === 'authenticated';
  const [layers, setLayers] = useState(['trails', 'segments']);
  const [view, setView] = useState('map');
  const [creating, setCreating] = useState(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [detail, setDetail] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [queue, setQueue] = useState([]);
  const [isModerator, setIsModerator] = useState(false);

  const bbox = useMemo(() => {
    if (!currentPosition) return null;
    return bboxFromViewport([currentPosition.latitude, currentPosition.longitude], 0.4, 0.4);
  }, [currentPosition]);
  const { trails, segments, loading, error } = useMtbMap(bbox, layers);
  const payload = useMemo(() => {
    const p = mtbOverlaysToMapPayload(trails, segments, layers);
    if (currentPosition && Number.isFinite(currentPosition.latitude)) {
      p.pins.push({ point: [currentPosition.latitude, currentPosition.longitude], title: 'Your current location', kind: 'location', radius: Math.max(0, Number(currentPosition.accuracy) || 0) });
    }
    return p;
  }, [trails, segments, layers, currentPosition]);

  const loadSubmissions = useCallback(async () => { try { setSubmissions(await mtbApi.mySubmissions()); } catch { setSubmissions([]); } }, []);
  const loadModeration = useCallback(async () => { try { setQueue(await mtbApi.moderationQueue()); setIsModerator(true); } catch { setIsModerator(false); setQueue([]); } }, []);
  useEffect(() => {
    if (!signedIn || !supabase) return;
    const timer = setTimeout(() => { void loadSubmissions(); void loadModeration(); }, 0);
    return () => clearTimeout(timer);
  }, [signedIn, loadSubmissions, loadModeration]);

  async function saveDraft(data) {
    setSaving(true); setNotice('');
    try {
      await (creating === 'trail' ? mtbApi.createTrail(data) : mtbApi.createSegment(data));
      setNotice('Saved as a draft. Open My trails to submit it for approval.');
      setCreating(null);
      await loadSubmissions();
    } catch (e) { setNotice(e.message || 'Could not save.'); }
    finally { setSaving(false); }
  }

  async function submitItem(item) { try { await mtbApi.submitMtb(item.kind, item.id); await loadSubmissions(); } catch (e) { setNotice(e.message); } }
  async function moderate(item, action, note = '') {
    try { await mtbApi.moderateMtb(item.kind, item.id, action, note); setQueue(q => q.filter(x => x.id !== item.id)); await loadSubmissions(); }
    catch (e) { setNotice(e.message); }
  }

  if (creating) return <MtbEditor kind={creating} onCancel={() => setCreating(null)} onSave={saveDraft} saving={saving} />;
  if (detail) return <MtbDetail item={detail} onBack={() => setDetail(null)} onSubmit={() => submitItem(detail)} onRecord={onRecordTrail ? () => onRecordTrail(detail) : null} />;

  return (
    <section className="mtb-map">
      <header className="mtb-head">
        <h2><Mountain size={18} /> Community trails</h2>
        <div className="mtb-tabs">
          {[['map', 'Map'], ['submissions', 'My trails'], ['moderation', 'Review']].map(([id, label]) => (
            <button type="button" key={id} className={view === id ? 'selected' : ''} onClick={() => setView(id)}>{label}</button>
          ))}
        </div>
      </header>

      {notice && <p role="status" className="notice">{notice}</p>}

      {view === 'map' && (
        <>
          <div className="mtb-layer-toggles">
            {[['trails', 'Trails'], ['segments', 'Segments']].map(([id, label]) => (
              <button type="button" key={id} className={layers.includes(id) ? 'selected' : ''} onClick={() => setLayers(l => toggleMtbLayer(l, id))}>{label}</button>
            ))}
          </div>
          <div className="mtb-create">
            <button type="button" className="primary" disabled={!signedIn} onClick={() => setCreating('trail')}><Plus size={16} /> Create trail</button>
            <button type="button" className="primary" disabled={!signedIn} onClick={() => setCreating('segment')}><Route size={16} /> Create segment</button>
          </div>
          {!signedIn && <p className="muted small-copy">Sign in to draw and submit trails.</p>}

          <AppleMap large payload={payload} />
          {loading && <p className="muted small-copy" role="status">Loading trails…</p>}
          {error && <p role="alert" className="error">{error}</p>}
          {!currentPosition && <p className="muted small-copy">Share your location to load nearby trails.</p>}

          {(trails.length > 0 || segments.length > 0) && (
            <ul className="mtb-list">
              {segments.map(s => <li key={s.id}><button type="button" onClick={() => setDetail({ kind: 'segment', ...s })}>{s.name} · {fmtMeters(s.distance_meters)} {s.direction !== 'both' ? `· ${s.direction}` : ''}</button></li>)}
              {trails.map(t => <li key={t.id}><button type="button" onClick={() => setDetail({ kind: 'trail', ...t })}>{t.name} · {fmtMeters(t.distance_meters)}</button></li>)}
            </ul>
          )}
        </>
      )}
      {view === 'submissions' && (
        <div className="mtb-submissions">
          {submissions.length === 0 && <p className="muted small-copy">Nothing here yet. Draw a trail or segment to get started.</p>}
          {submissions.map(item => (
            <div className="mtb-row" key={item.id}>
              <div><strong>{item.name}</strong><p className="muted small-copy">{item.kind} · {MTB_STATUS_LABELS[item.status] || item.status}{item.moderation_note ? ` · ${item.moderation_note}` : ''}</p></div>
              {(item.status === 'draft' || item.status === 'changes_requested') && <button type="button" className="primary" onClick={() => submitItem(item)}>Submit</button>}
            </div>
          ))}
        </div>
      )}

      {view === 'moderation' && (
        <div className="mtb-moderation">
          {!isModerator && <p className="muted small-copy"><ShieldAlert size={14} /> Reviewing is available to community moderators only.</p>}
          {queue.map(item => (
            <div className="mtb-row" key={item.id}>
              <button type="button" className="mtb-row-main" onClick={() => setDetail({ kind: item.kind, ...item })}>
                <strong>{item.name}</strong>
                <p className="muted small-copy">{item.kind} · {MTB_STATUS_LABELS[item.status]} · {MTB_ACCESS_LABELS[item.access] || item.access} · {fmtMeters(item.distance_meters)}</p>
              </button>
              <button type="button" className="primary" onClick={() => moderate(item, 'approved', '')}><Check size={15} /> Approve</button>
              <button type="button" className="secondary" onClick={() => moderate(item, 'rejected', '')}><X size={15} /> Reject</button>
              <button type="button" className="secondary" onClick={() => moderate(item, 'changes_requested', prompt('What needs to change?') || '')}><MessageSquare size={15} /> Changes</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function MtbDetail({ item, onBack, onSubmit, onRecord }) {
  return (
    <section className="mtb-detail">
      <header className="mtb-editor-head"><h2>{item.name}</h2><button type="button" className="icon-button" aria-label="Back" onClick={onBack}><X size={20} /></button></header>
      <AppleMap large payload={{ routes: [item.geometry || []], pins: [] }} />
      <dl>
        <dt>Distance</dt><dd>{fmtMeters(item.distance_meters)}</dd>
        <dt>Direction</dt><dd>{item.direction || 'both'}</dd>
        <dt>Difficulty</dt><dd>{item.difficulty || 'unknown'}</dd>
        <dt>Access</dt><dd>{MTB_ACCESS_LABELS[item.access] || item.access}</dd>
        <dt>Status</dt><dd>{MTB_STATUS_LABELS[item.status] || item.status}</dd>
      </dl>
      {accessRestricted(item.access) && <p role="status" className="notice">Access is restricted. This trail is not publicly promoted.</p>}
      {onRecord && item.kind === 'trail' && <><button type="button" className="primary" onClick={onRecord}><Mountain size={16} /> Record this trail</button><p className="muted small-copy">Starts a mountain-bike recording already linked to this trail. The link and your GPS stay private; nothing is published to the community.</p></>}
      {(item.status === 'draft' || item.status === 'changes_requested') && <button type="button" className="primary" onClick={onSubmit}>Submit for approval</button>}
    </section>
  );
}

