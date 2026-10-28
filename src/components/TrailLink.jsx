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
  const [message, setMessage] = useState('');
  const linked = trip?.trail || null;

  async function browse() {
    setOpen(true); setMessage('');
    if (candidates) return;
    const bbox = routeBounds(trip?.route || []);
    if (!bbox) { setCandidates([]); setMessage('This ride has no GPS route to search near.'); return; }
    setLoading(true);
    try {
      setCandidates(trailCandidates(await mtbApi.fetchTrails(bbox), trip?.route || []));
    } catch (e) {
      setCandidates([]);
      setMessage(e?.message || 'Trails could not be loaded. Check your connection and try again.');
    } finally { setLoading(false); }
  }

  async function link(candidate) {
    const result = await perform('assignTrail', { id: trip.id, ...trailLinkPayload(candidate) });
    if (result) { setOpen(false); setMessage(`Linked to ${candidate.name}.`); }
  }

  async function unlink() {
    const result = await perform('assignTrail', { id: trip.id });
    if (result) { setOpen(false); setCandidates(null); setMessage('Trail link removed. The ride is unchanged and its GPS stays private.'); }
  }

  return <section className="trail-link" aria-label="Mountain bike trail">
    <div className="section-heading"><h2><Mountain size={18} /> Trail</h2>{linked && <span className="local-badge">Linked</span>}</div>
    {linked
      ? <div className="trail-link-current"><strong>{trailLinkLabel(linked)}</strong><p className="muted small-copy">Linked privately on this device. Community trail details are not changed by this ride.</p>
          <div className="detail-actions"><button type="button" className="secondary" disabled={busy || loading} onClick={browse}>Change trail</button><button type="button" className="text-button" disabled={busy} onClick={unlink}><Unlink size={15} /> Remove link</button></div></div>
      : <><p className="muted small-copy">Link this ride to a nearby community trail. The link is stored with the activity, so it works offline and never publishes your route.</p>
          <button type="button" className="secondary" disabled={busy || loading} onClick={browse}><Link2 size={16} /> {loading ? 'Looking for trails…' : 'Find nearby trails'}</button></>}
    {open && <div className="trail-link-options">
      {loading && <p role="status" className="muted small-copy">Looking for trails near this ride…</p>}
      {!loading && candidates?.length === 0 && <p className="muted small-copy">No community trails found near this ride yet.</p>}
      {!loading && candidates?.map(candidate => <button type="button" key={candidate.id} className="trail-link-option" aria-pressed={candidate.id === linked?.id} disabled={busy} onClick={() => link(candidate)}>
        <span><strong>{candidate.name}</strong><small>{fmt(candidate.distanceMeters)} · {candidate.difficulty} · {MTB_ACCESS_LABELS[candidate.access] || candidate.access}{candidate.startDistanceMeters != null ? ` · starts ${fmt(candidate.startDistanceMeters)} from this ride` : ''}</small></span>
        {candidate.id === linked?.id ? <Check size={16} /> : <Link2 size={16} />}
      </button>)}
    </div>}
    {message && <p role="status" className="notice">{message}</p>}
  </section>;
}
