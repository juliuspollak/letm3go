import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, LifeBuoy, LoaderCircle, Lock, MessageCircle, Send, X } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { useAuth } from '../lib/AuthContext.jsx';
import { supabase } from '../lib/supabase.js';
import Switch from './Switch.jsx';
import FeedbackPhotos from './FeedbackPhotos.jsx';
import {
  FEEDBACK_CATEGORIES, emptyFeedbackDraft, feedbackCategory, feedbackDate, feedbackDiagnostics,
  feedbackErrors, feedbackHasUnread, feedbackHeadline, feedbackReference, feedbackStatus,
  loadFeedbackHistory, markFeedbackSeen, newFeedbackToken, submitFeedbackTicket,
} from '../lib/feedback.js';

const SECTIONS = [
  { id: 'send', label: 'Send feedback' },
  { id: 'mine', label: 'My feedback' },
  { id: 'help', label: 'Help' },
];

const HELP_TOPICS = [
  { title: 'Recording stopped or has gaps', body: 'Open Profile → Tracking & Permissions and check that location is set to Always, Precise Location is on, and Low Power Mode is off. Background recording needs the app to stay installed and signed in.' },
  { title: 'A journey is missing from History', body: 'Automatic journeys appear after the drive or ride finishes and GPS fixes settle. Short trips and stationary periods can be held back. Open the app once to let detection finish.' },
  { title: 'The map has no routes', body: 'Routes are drawn from journeys stored on this device. Try Profile → Diagnostics to confirm there are completed trips, and check that saved places still have permission to be read.' },
  { title: 'Notifications are not arriving', body: 'Enable notifications for letm3go in iOS Settings. Sharing and household alerts also require a working connection; the app never exposes your exact position publicly.' },
  { title: 'Privacy and backups', body: 'Your journeys are private by default. A private backup is encrypted before it leaves this device. You can export or delete everything from Account & settings.' },
];

export default function FeedbackSupport({ recording }) {
  const auth = useAuth();
  const state = recording?.state || {};
  const [section, setSection] = useState('send');
  const [draft, setDraft] = useState(emptyFeedbackDraft);
  const [errors, setErrors] = useState({});
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [diagnosticsEnabled, setDiagnosticsEnabled] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState({ status: 'idle', tickets: [], error: '' });
  const [refresh, setRefresh] = useState(0);
  const [openTicket, setOpenTicket] = useState('');
  const [reply, setReply] = useState('');
  const [replyBusy, setReplyBusy] = useState('');
  const [replyError, setReplyError] = useState('');
  const [viewer, setViewer] = useState(null);
  const token = useRef(newFeedbackToken());
  const attachmentsRef = useRef(attachments);
  const formRef = useRef(null);

  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);
  useEffect(() => () => { attachmentsRef.current.forEach(photo => URL.revokeObjectURL(photo.previewUrl)); }, []);

  // The history loads when its tab opens and again after a successful submission.
  useEffect(() => {
    if (section !== 'mine' || !supabase) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const tickets = await loadFeedbackHistory(supabase);
        if (cancelled) return;
        setHistory({ status: 'ready', tickets, error: '' });
        if (tickets.some(ticket => feedbackHasUnread(ticket)) && !await markFeedbackSeen(supabase) && !cancelled) {
          console.warn('Feedback read receipt could not be saved; it will retry next time.');
        }
      } catch (caught) {
        if (!cancelled) setHistory({ status: 'error', tickets: [], error: caught.message || 'Your feedback could not be loaded.' });
      }
    })();
    return () => { cancelled = true; };
  }, [section, refresh]);

  const viewerOpen = Boolean(viewer);

  // Escape closes the photo viewer without closing the whole sheet.
  useEffect(() => {
    if (!viewerOpen) return undefined;
    function keydown(event) {
      if (!['Escape', 'ArrowRight', 'ArrowLeft'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') setViewer(null);
      else setViewer(current => current ? { ...current, index: (current.index + (event.key === 'ArrowRight' ? 1 : -1) + current.photos.length) % current.photos.length } : current);
    }
    document.addEventListener('keydown', keydown, true);
    return () => document.removeEventListener('keydown', keydown, true);
  }, [viewerOpen]);

  function showSection(id) {
    setSection(id);
    setError('');
    // Status changes belong in the handler; the loader effect only writes after its await.
    if (id === 'mine' && section !== 'mine') {
      setHistory(current => ({ ...current, status: current.tickets.length ? 'refreshing' : 'loading', error: '' }));
    }
  }

  function reloadHistory() {
    setHistory(current => ({ ...current, status: current.tickets.length ? 'refreshing' : 'loading', error: '' }));
    setRefresh(value => value + 1);
  }


  function update(field, value) {
    setDraft(current => ({ ...current, [field]: value }));
    setErrors(current => ({ ...current, [field]: undefined }));
  }

  function addPhotos(photos) { setAttachments(current => [...current, ...photos]); }

  function removePhoto(id) {
    setAttachments(current => {
      const photo = current.find(item => item.id === id);
      if (photo) URL.revokeObjectURL(photo.previewUrl);
      return current.filter(item => item.id !== id);
    });
  }

  function openPhoto(index) {
    setViewer({ photos: attachments.map((photo, position) => ({ url: photo.previewUrl, alt: `Attachment ${position + 1}` })), index });
  }

  function openHistoryPhoto(ticket, index) {
    const photos = ticket.attachments.filter(item => item.url).map((item, position) => ({ url: item.url, alt: `Attachment ${position + 1}` }));
    if (photos.length) setViewer({ photos, index });
  }

  function handleEvent(event) {
    if (event.phase === 'ticket') { setProgress({ label: 'Sending your feedback…', percent: 8 }); return; }
    setProgress({ label: `Uploading photo · ${event.percent || 0}%`, percent: 8 + Math.round((event.percent || 0) * 0.92) });
    setAttachments(current => current.map(photo => photo.id === event.id
      ? { ...photo, status: event.status, percent: event.percent || 0, error: event.error || '' }
      : photo));
  }

  async function send() {
    if (!supabase) { setError('Feedback needs a connection to your account. Check your connection and retry.'); return; }
    const issues = feedbackErrors(draft);
    setErrors(issues);
    if (Object.keys(issues).length) {
      setError('Please complete the highlighted fields.');
      formRef.current?.querySelector('[aria-invalid="true"]')?.focus();
      return;
    }
    setSubmitting(true);
    setError('');
    setResult(null);
    try {
      const outcome = await submitFeedbackTicket(supabase, {
        token: token.current,
        draft,
        diagnostics: diagnosticsEnabled ? feedbackDiagnostics({ state, preferences: auth.preferences, session: auth.session, native: Capacitor.isNativePlatform() }) : null,
        attachments,
        state,
        native: Capacitor.isNativePlatform(),
        onEvent: handleEvent,
      });
      setResult(outcome);
      setRefresh(value => value + 1);
    } catch (caught) {
      setError(caught.message || 'Feedback could not be sent. Check your connection and retry.');
    } finally {
      setSubmitting(false);
      setProgress(null);
    }
  }

  function startOver() {
    attachments.forEach(photo => URL.revokeObjectURL(photo.previewUrl));
    setAttachments([]);
    setDraft(emptyFeedbackDraft());
    setErrors({});
    setError('');
    setProgress(null);
    setResult(null);
    setDetailsOpen(false);
    token.current = newFeedbackToken();
  }

  async function sendReply(ticket, event) {
    event.preventDefault();
    const body = reply.trim();
    if (!body || !supabase) return;
    setReplyBusy(ticket.id);
    setReplyError('');
    try {
      const { error: replyFailure } = await supabase.rpc('add_feedback_message', { p_feedback_id: ticket.id, p_body: body });
      if (replyFailure) throw replyFailure;
      setHistory(current => ({
        ...current,
        tickets: current.tickets.map(item => item.id === ticket.id ? {
          ...item,
          updated_at: new Date().toISOString(),
          messages: [...item.messages, { id: `local-${Date.now()}`, feedback_id: ticket.id, author_id: auth.session?.user?.id, is_staff: false, body, created_at: new Date().toISOString() }],
        } : item),
      }));
      setReply('');
    } catch (caught) {
      setReplyError(caught.message || 'Your reply could not be sent. Please retry.');
    } finally {
      setReplyBusy('');
    }
  }


  const showReceipt = Boolean(result);
  return <>
    <p className="eyebrow">WE&apos;RE LISTENING</p>
    <h2>Feedback &amp; Support</h2>
    <p className="muted feedback-intro">Tell us what broke, what would help, or ask a question. Your message goes to the small letm3go team — never to other members or people you share with.</p>

    <div className="feedback-sections" role="group" aria-label="Feedback sections">
      {SECTIONS.map(item => <button key={item.id} type="button" className={section === item.id ? 'selected' : ''} aria-pressed={section === item.id} onClick={() => showSection(item.id)}>{item.label}{item.id === 'mine' && history.tickets.some(feedbackHasUnread) && <span className="feedback-dot" aria-label="Unread reply" />}</button>)}
    </div>

    {section === 'send' && (showReceipt ? <div className="feedback-receipt" role="status">
      <span className="feedback-receipt-icon"><CheckCircle2 size={30} /></span>
      <h3>Thank you — we have it.</h3>
      <p>Reference <strong>{feedbackReference(result.ticket)}</strong>. A staff reply, if needed, will appear under My feedback.</p>
      {result.photoError && <div className="error feedback-receipt-warning" role="alert">
        <p>Your report is safely saved, but a photo did not upload: {result.photoError}</p>
        <button type="button" className="secondary" disabled={submitting} onClick={() => void send()}>{submitting ? 'Retrying…' : 'Retry photo upload'}</button>
      </div>}
      <div className="feedback-receipt-actions">
        <button type="button" className="primary" onClick={() => { setOpenTicket(result.ticket.id); showSection('mine'); }}>View my feedback</button>
        <button type="button" className="secondary" onClick={startOver}>Send something else</button>
      </div>
    </div> : <form ref={formRef} className="feedback-form" noValidate onSubmit={event => { event.preventDefault(); void send(); }}>
      <fieldset className="feedback-categories">
        <legend>What is this about?</legend>
        <div className="feedback-category-grid">
          {FEEDBACK_CATEGORIES.map(item => {
            const selected = draft.category === item.id;
            return <label key={item.id} className={`feedback-category${selected ? ' selected' : ''}`}>
              <input type="radio" name="feedback-category" value={item.id} checked={selected} disabled={submitting} onChange={() => update('category', item.id)} />
              <span><strong>{item.label}</strong><small>{item.hint}</small></span>
            </label>;
          })}
        </div>
      </fieldset>
      {errors.category && <p className="error field-error" role="alert">{errors.category}</p>}

      <label className="feedback-field" htmlFor="feedback-title">Title <span className="muted">(optional)</span>
        <input id="feedback-title" maxLength={120} value={draft.title} onChange={event => update('title', event.target.value)} disabled={submitting} aria-invalid={Boolean(errors.title)} placeholder={draft.category === 'idea' ? 'A short name for your idea' : 'A short summary'} />
        {errors.title && <small className="field-error" role="alert">{errors.title}</small>}
      </label>

      <label className="feedback-field" htmlFor="feedback-description">What happened?
        <textarea id="feedback-description" rows={6} maxLength={4000} required value={draft.description} onChange={event => update('description', event.target.value)} disabled={submitting} aria-invalid={Boolean(errors.description)} placeholder={draft.category === 'bug' ? 'What were you doing, and what went wrong?' : draft.category === 'idea' ? 'What would you like to be able to do?' : 'Share the details that would help us understand.'} />
        <span className="feedback-count" aria-hidden="true">{draft.description.length}/4000</span>
        {errors.description && <small className="field-error" role="alert">{errors.description}</small>}
      </label>

      <button type="button" className="feedback-details-toggle" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(value => !value)}>
        Add details that help us reproduce it <ChevronDown className={detailsOpen ? 'open' : ''} size={16} aria-hidden="true" />
      </button>
      {detailsOpen && <div className="feedback-details">
        <label htmlFor="feedback-what">What happened
          <textarea id="feedback-what" rows={2} maxLength={2000} value={draft.whatHappened} onChange={event => update('whatHappened', event.target.value)} disabled={submitting} />
        </label>
        <label htmlFor="feedback-expected">What you expected
          <textarea id="feedback-expected" rows={2} maxLength={2000} value={draft.expected} onChange={event => update('expected', event.target.value)} disabled={submitting} />
        </label>
        <label htmlFor="feedback-steps">Steps to reproduce
          <textarea id="feedback-steps" rows={3} maxLength={2000} value={draft.steps} onChange={event => update('steps', event.target.value)} disabled={submitting} placeholder={'1. Open…\n2. Tap…\n3. See…'} />
        </label>
      </div>}


      <FeedbackPhotos photos={attachments} onAdd={addPhotos} onRemove={removePhoto} onView={openPhoto} disabled={submitting} />

      <div className="feedback-diagnostics">
        <div>
          <strong>Include diagnostic details</strong>
          <p>App version, screen size, recording permission and trip count. These are optional and help us reproduce bugs.</p>
        </div>
        <Switch checked={diagnosticsEnabled} onChange={setDiagnosticsEnabled} label="Include diagnostic details" disabled={submitting} />
      </div>
      <p className="feedback-privacy"><Lock size={14} aria-hidden="true" /> Diagnostics never include routes, coordinates, saved places, photos you did not add, or your email address.</p>
      {diagnosticsEnabled && <details className="feedback-diagnostics-preview">
        <summary>See exactly what is shared</summary>
        <dl>
          <div><dt>App</dt><dd>{state.version || 'unknown'} ({state.build || 'unknown'})</dd></div>
          <div><dt>Platform</dt><dd>{Capacitor.isNativePlatform() ? 'iOS' : 'Web'}</dd></div>
          <div><dt>Language &amp; time zone</dt><dd>{navigator.language || 'unknown'} · {Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown'}</dd></div>
          <div><dt>Screen</dt><dd>{window.screen?.width || 0}×{window.screen?.height || 0} @{window.devicePixelRatio || 1}x</dd></div>
          <div><dt>Recording</dt><dd>{state.permission || 'unknown'} · storage {state.storageReady ? 'ready' : 'unavailable'} · {state.trips?.length || 0} trips</dd></div>
        </dl>
      </details>}

      {auth.status === 'offline' && <p className="notice" role="status">You are offline. Reconnect before sending; your draft stays on this screen.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {progress && <div className="feedback-progress" role="status">
        <div aria-hidden="true"><span style={{ width: `${progress.percent}%` }} /></div>
        <small>{progress.label}</small>
      </div>}
      <button type="submit" className="primary full" disabled={submitting || auth.status === 'offline'}>
        {submitting ? <><LoaderCircle className="spin" size={17} aria-hidden="true" /> Sending…</> : <><Send size={17} aria-hidden="true" /> Send feedback</>}
      </button>
      <small className="muted feedback-hint">We usually reply within a few working days. Check My feedback for updates.</small>
    </form>)}


    {section === 'mine' && <section className="feedback-history" aria-label="My feedback">
      <div className="feedback-history-head">
        <div><h3>Your conversations</h3><p className="muted small-copy">Replies from the letm3go team appear here.</p></div>
        <button type="button" className="text-button" disabled={history.status === 'loading' || history.status === 'refreshing'} onClick={reloadHistory}>Refresh</button>
      </div>
      {!supabase && <p className="notice" role="status">Feedback history needs a connection to your account.</p>}
      {supabase && history.status === 'loading' && <p className="feedback-loading" role="status"><LoaderCircle className="spin" size={17} /> Loading your feedback…</p>}
      {history.status === 'error' && <div className="error" role="alert"><p>{history.error}</p><button type="button" className="secondary" onClick={reloadHistory}>Try again</button></div>}
      {history.status === 'ready' && history.tickets.length === 0 && <div className="feedback-empty">
        <MessageCircle size={26} aria-hidden="true" />
        <h3>Nothing here yet</h3>
        <p className="muted">When you send feedback, you can follow it here — including any reply from us.</p>
        <button type="button" className="secondary" onClick={() => setSection('send')}>Send feedback</button>
      </div>}
      {history.tickets.map(ticket => {
        const status = feedbackStatus(ticket.status);
        const open = openTicket === ticket.id;
        const unread = feedbackHasUnread(ticket);
        return <article key={ticket.id} className={`feedback-ticket${open ? ' is-open' : ''}`}>
          <button type="button" className="feedback-ticket-head" aria-expanded={open} onClick={() => { setOpenTicket(open ? '' : ticket.id); setReply(''); setReplyError(''); }}>
            <span className="feedback-ticket-title"><strong>{feedbackHeadline(ticket)}</strong><small>{feedbackCategory(ticket.category).label} · {feedbackDate(ticket.created_at)}</small></span>
            {unread && <span className="feedback-unread">New reply</span>}
            <span className={`feedback-status ${status.tone}`}>{status.label}</span>
            <ChevronDown size={17} className={open ? 'open' : ''} aria-hidden="true" />
          </button>
          {open && <div className="feedback-ticket-body">
            <span className="feedback-reference">Reference {feedbackReference(ticket)}</span>
            <p className="feedback-ticket-description">{ticket.description}</p>
            {ticket.what_happened && <div className="feedback-answer"><strong>What happened</strong><p>{ticket.what_happened}</p></div>}
            {ticket.expected_behaviour && <div className="feedback-answer"><strong>Expected</strong><p>{ticket.expected_behaviour}</p></div>}
            {ticket.steps_to_reproduce && <div className="feedback-answer"><strong>Steps</strong><p>{ticket.steps_to_reproduce}</p></div>}

            {ticket.attachments.some(photo => photo.url) && <div className="feedback-history-photos">
              {ticket.attachments.filter(photo => photo.url).map((photo, index) => <button key={photo.id} type="button" onClick={() => openHistoryPhoto(ticket, index)} aria-label={`View attachment ${index + 1}`}><img src={photo.url} alt={`Attachment ${index + 1}`} /></button>)}
            </div>}
            {ticket.messages.length > 0 && <ul className="feedback-thread" aria-label="Conversation">
              {ticket.messages.map(message => <li key={message.id} className={message.is_staff ? 'staff' : 'owner'}>
                <small>{message.is_staff ? 'letm3go support' : 'You'} · {feedbackDate(message.created_at, { withTime: true })}</small>
                <p>{message.body}</p>
              </li>)}
            </ul>}
            {ticket.messages.length === 0 && ticket.status !== 'closed' && <p className="muted small-copy">No replies yet. We read every report.</p>}
            {ticket.status === 'closed' ? <p className="muted small-copy">This conversation is closed. Send new feedback if you need anything else.</p> : <form className="feedback-reply" onSubmit={event => void sendReply(ticket, event)}>
              <label htmlFor={`feedback-reply-${ticket.id}`}>Reply <span className="muted">(optional)</span>
                <textarea id={`feedback-reply-${ticket.id}`} rows={2} maxLength={4000} value={reply} onChange={event => setReply(event.target.value)} disabled={replyBusy === ticket.id} />
              </label>
              {replyError && <p className="error" role="alert">{replyError}</p>}
              <button type="submit" className="secondary" disabled={replyBusy === ticket.id || !reply.trim()}>{replyBusy === ticket.id ? 'Sending…' : 'Send reply'}</button>
            </form>}
          </div>}
        </article>;
      })}
    </section>}

    {section === 'help' && <section className="feedback-help" aria-label="Help and troubleshooting">
      <div className="feedback-help-intro"><LifeBuoy size={22} aria-hidden="true" /><div><h3>Try these first</h3><p className="muted small-copy">Most issues come down to permissions or a fresh location fix.</p></div></div>
      {HELP_TOPICS.map(topic => <details key={topic.title} className="feedback-help-topic">
        <summary>{topic.title}<ChevronDown size={16} aria-hidden="true" /></summary>
        <p>{topic.body}</p>
      </details>)}
      <div className="feedback-help-contact">
        <h3>Still stuck?</h3>
        <p>Send feedback with diagnostic details switched on. Include the screen you were on and what you expected to happen — that usually saves a round trip.</p>
        <button type="button" className="primary full" onClick={() => setSection('send')}>Send feedback</button>
      </div>
    </section>}

    {viewer && <div className="feedback-viewer" role="dialog" aria-modal="true" aria-label="Photo viewer" onClick={() => setViewer(null)}>
      <div className="feedback-viewer-inner" onClick={event => event.stopPropagation()}>
        <button type="button" className="feedback-viewer-close" onClick={() => setViewer(null)} aria-label="Close photo"><X size={20} /></button>
        {viewer.photos.length > 1 && <button type="button" className="feedback-viewer-nav prev" onClick={() => setViewer(current => ({ ...current, index: (current.index - 1 + current.photos.length) % current.photos.length }))} aria-label="Previous photo"><ChevronLeft size={22} /></button>}
        <img src={viewer.photos[viewer.index]?.url} alt={viewer.photos[viewer.index]?.alt || 'Feedback attachment'} />
        {viewer.photos.length > 1 && <button type="button" className="feedback-viewer-nav next" onClick={() => setViewer(current => ({ ...current, index: (current.index + 1) % current.photos.length }))} aria-label="Next photo"><ChevronRight size={22} /></button>}
        <p>{viewer.index + 1} / {viewer.photos.length}</p>
      </div>
    </div>}
  </>;
}

