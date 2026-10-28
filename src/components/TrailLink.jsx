import { useState } from 'react';
import { Check, Link2, Mountain, Unlink } from 'lucide-react';
import * as mtbApi from '../lib/mtbApi.js';
import { MTB_ACCESS_LABELS } from '../lib/mtb.js';
import { routeBounds, trailCandidates, trailLinkLabel, trailLinkPayload } from '../lib/mtbLink.js';

const fmt = m => Number.isFinite(m) ? (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`) : 'Unknown length';

// Links a finished mountain-bike ride to a community trail. The link is written
// to the local activity (native `assignTrail`), so it is private, works offline
// and never uploads the ride's GPS trace to the trail catalogue.
export default function TrailLink({ trip, perform, busy }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState(null);
  // Which ride and route the current candidates belong to. Without this a search
  // for one ride would be reused for the next one, and a failed search would never
  // be retried because an empty list is still "loaded".
  const [loadedFor, setLoadedFor] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const linked = trip?.trail || null;
  const route = Array.isArray(trip?.route) ? trip.route : [];
  const searchFor = `${trip?.id || ''}:${route.length}`;

  async function browse({ force = false } = {}) {
    setOpen(true); setMessage('');
    if (!force && candidates && loadedFor === searchFor) return;
    const bbox = routeBounds(route);
    if (!bbox) {
      setCandidates(null); setLoadedFor(null); setError('');
      setMessage('This ride has no GPS route to search near.');
      return;
    }
    setLoading(true); setError('');
    try {
      setCandidates(trailCandidates(await mtbApi.fetchTrails(bbox), route));
      setLoadedFor(searchFor);
    } catch (e) {
      // A failed lookup stays retryable: the list is discarded and the reason is
      // shown with a Try again action instead of an empty "no trails" result.
      setCandidates(null); setLoadedFor(null);
      setError(e?.message || 'Trails could not be loaded. Check your connection and try again.');
    } finally { setLoading(false); }
  }

  async function link(candidate) {
    const result = await perform('assignTrail', { id: trip.id, ...trailLinkPayload(candidate) });
    if (result) { setOpen(false); setMessage(`Linked to ${candidate.name}.`); }
  }

  async function unlink() {
    const result = await perform('assignTrail', { id: trip.id });
    if (result) { setOpen(false); setCandidates(null); setLoadedFor(null); setMessage('Trail link removed. The ride is unchanged and its GPS stays private.'); }
  }

  return <section className="trail-link" aria-label="Mountain bike trail">
    <div className="section-heading"><h2><Mountain size={18} /> Trail</h2>{linked && <span className="local-badge">Linked</span>}</div>
    {linked
      ? <div className="trail-link-current"><strong>{trailLinkLabel(linked)}</strong><p className="muted small-copy">Linked privately on this device. Community trail details are not changed by this ride.</p>
          <div className="detail-actions"><button type="button" className="secondary" disabled={busy || loading} onClick={() => browse()}>Change trail</button><button type="button" className="text-button" disabled={busy} onClick={unlink}><Unlink size={15} /> Remove link</button></div></div>
      : <><p className="muted small-copy">Link this ride to a nearby community trail. The link is stored with the activity, so it works offline and never publishes your route.</p>
          <button type="button" className="secondary" disabled={busy || loading} onClick={() => browse()}><Link2 size={16} /> {loading ? 'Looking for trails…' : 'Find nearby trails'}</button></>}
    {open && <div className="trail-link-options">
      {loading && <p role="status" className="muted small-copy">Looking for trails near this ride…</p>}
      {!loading && error && <div className="trail-link-error">
        <p role="alert" className="notice">{error}</p>
        <button type="button" className="secondary" disabled={busy} onClick={() => browse({ force: true })}>Try again</button>
      </div>}
      {!loading && !error && candidates?.length === 0 && <p className="muted small-copy">No community trails found near this ride yet.</p>}
      {!loading && !error && candidates?.map(candidate => <button type="button" key={candidate.id} className="trail-link-option" aria-pressed={candidate.id === linked?.id} disabled={busy} onClick={() => link(candidate)}>
        <span><strong>{candidate.name}</strong><small>{fmt(candidate.distanceMeters)} · {candidate.difficulty} · {MTB_ACCESS_LABELS[candidate.access] || candidate.access}{candidate.startDistanceMeters != null ? ` · starts ${fmt(candidate.startDistanceMeters)} from this ride` : ''}</small></span>
        {candidate.id === linked?.id ? <Check size={16} /> : <Link2 size={16} />}
      </button>)}
    </div>}
    {message && <p role="status" className="notice">{message}</p>}
  </section>;
}
