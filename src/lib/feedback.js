// Pure helpers for Feedback & Support: validation, optional diagnostics, history shaping
// and the idempotent submission pipeline used by both the app and its tests.
import { config } from './config.js';
import { newUUID } from './uuid.js';

export const MAX_ATTACHMENTS = 5;
// The same figure as the bucket's file_size_limit and the attachment row's check.
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// One attempt at one photo, and one call to the database. A retried upload reuses
// its object key and a retried call its token, so giving up never costs a duplicate.
export const UPLOAD_TIMEOUT_MS = 120_000;
export const REQUEST_TIMEOUT_MS = 30_000;
const UPLOAD_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1_000;

export const FEEDBACK_CATEGORIES = [
  { id: 'bug', label: 'Bug report', hint: 'Something broke or behaves unexpectedly.' },
  { id: 'idea', label: 'Feature idea', hint: 'A new capability you would find useful.' },
  { id: 'improvement', label: 'Improvement', hint: 'Something existing could work better.' },
  { id: 'other', label: 'Something else', hint: 'Questions, privacy or anything else.' },
];

export const FEEDBACK_STATUSES = {
  open: { label: 'Received', tone: 'open' },
  in_review: { label: 'Being reviewed', tone: 'review' },
  resolved: { label: 'Resolved', tone: 'resolved' },
  closed: { label: 'Closed', tone: 'closed' },
};

export const FEEDBACK_BUCKET = 'feedback-attachments';

export function feedbackCategory(id) {
  return FEEDBACK_CATEGORIES.find(item => item.id === id) || FEEDBACK_CATEGORIES[FEEDBACK_CATEGORIES.length - 1];
}

export function feedbackStatus(id) {
  return FEEDBACK_STATUSES[id] || FEEDBACK_STATUSES.open;
}

export const newFeedbackToken = newUUID;

export class FeedbackCancelled extends Error {
  constructor() {
    super('Sending was cancelled.');
    this.name = 'FeedbackCancelled';
  }
}

// Worth one more attempt on its own: the request never got a real answer.
function transient(message) {
  return Object.assign(new Error(message), { transient: true });
}

// Stops waiting; it cannot unsend. Whatever it wraps must be safe to repeat.
function bounded(work, { signal, ms = REQUEST_TIMEOUT_MS, message = 'The connection timed out. Check your connection and retry.' } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new FeedbackCancelled()); return; }
    const cancel = () => reject(new FeedbackCancelled());
    const timer = setTimeout(() => reject(transient(message)), ms);
    signal?.addEventListener('abort', cancel, { once: true });
    Promise.resolve(work).then(resolve, reject).finally(() => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    });
  });
}

export function emptyFeedbackDraft() {
  return { category: '', title: '', description: '', whatHappened: '', expected: '', steps: '' };
}

export function feedbackErrors(draft) {
  const errors = {};
  if (!FEEDBACK_CATEGORIES.some(item => item.id === draft.category)) errors.category = 'Choose what your feedback is about.';
  const description = draft.description?.trim() || '';
  if (!description) errors.description = 'Tell us what happened or what you need.';
  else if (description.length > 4000) errors.description = 'Keep it under 4,000 characters.';
  if ((draft.title || '').length > 120) errors.title = 'Keep the title under 120 characters.';
  return errors;
}

export function feedbackDiagnostics({ state = {}, preferences = {}, session, native = false }) {
  // A deliberately small snapshot. Routes, coordinates, saved places, email and IDs never leave the device.
  return {
    schema: 1,
    app: { version: String(state.version || 'unknown'), build: String(state.build || 'unknown') },
    platform: native ? 'ios' : 'web',
    locale: globalThis.navigator?.language || 'unknown',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
    screen: typeof window === 'undefined' ? 'unknown' : `${window.screen?.width || 0}x${window.screen?.height || 0}@${window.devicePixelRatio || 1}`,
    recording: {
      permission: state.permission || 'unknown',
      precise: Boolean(state.precise),
      storageReady: Boolean(state.storageReady),
      automaticEnabled: Boolean(state.automaticEnabled),
      automaticState: state.automaticState || 'idle',
      backgroundCapability: Boolean(state.backgroundEnabled),
      active: state.active?.state === 'recording',
      trips: Array.isArray(state.trips) ? state.trips.length : 0,
    },
    cloud: {
      signedIn: Boolean(session?.user?.id),
      lastBackup: preferences.lastBackup || null,
    },
  };
}

export function feedbackReference(ticket) {
  return ticket?.id ? `FB-${String(ticket.id).slice(0, 8).toUpperCase()}` : 'FB-PENDING';
}

export function feedbackDate(value, { withTime = false } = {}) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) });
}

export function feedbackHeadline(ticket) {
  return (ticket?.title || '').trim() || (ticket?.description || '').trim().split('\n')[0].slice(0, 80) || 'Feedback';
}

export function feedbackHasUnread(ticket) {
  const seen = ticket?.user_seen_at ? new Date(ticket.user_seen_at).getTime() : 0;
  return (ticket?.messages || []).some(message => message.is_staff && new Date(message.created_at).getTime() > seen);
}

// The server has the receipt, so the tab stops counting these as unread. `freshReply`
// keeps the ticket's own label until it is opened, or the list could not say which
// conversation the reply is in. Times come from the messages: this device's clock can
// be behind the server's, which would leave the reply unread.
export function feedbackMarkedSeen(tickets) {
  return tickets.map(ticket => {
    if (!feedbackHasUnread(ticket)) return ticket;
    const latest = Math.max(...ticket.messages.filter(message => message.is_staff).map(message => new Date(message.created_at).getTime()));
    return { ...ticket, user_seen_at: new Date(latest).toISOString(), freshReply: true };
  });
}

function trimmed(value) {
  return String(value || '').trim();
}

export function feedbackDiagnosticsOptIn(diagnostics) {
  return diagnostics && typeof diagnostics === 'object' ? diagnostics : null;
}

export function feedbackArguments({ token, draft, diagnostics, state = {}, native = false }) {
  return {
    p_client_token: token,
    p_category: draft.category,
    p_title: trimmed(draft.title),
    p_description: trimmed(draft.description),
    p_what_happened: trimmed(draft.whatHappened) || null,
    p_expected_behaviour: trimmed(draft.expected) || null,
    p_steps_to_reproduce: trimmed(draft.steps) || null,
    p_diagnostics: feedbackDiagnosticsOptIn(diagnostics),
    p_app_version: state.version || null,
    p_build_number: state.build || null,
    p_platform: native ? 'ios' : 'web',
  };
}

export function feedbackErrorMessage(error, fallback = 'Feedback could not be sent. Check your connection and retry.') {
  const message = String(error?.message || '').trim();
  if (!message) return fallback;
  if (/jwt|session/i.test(message)) return 'Your session expired. Sign in again and retry.';
  if (/duplicate key/i.test(message)) return 'This feedback was already received. Open My feedback to check it.';
  if (/row-level security|permission denied/i.test(message) && !/feedback/i.test(message)) return 'This account cannot send feedback right now.';
  return message.slice(0, 240);
}

export function storageUpload({ url, apiKey, token, path, blob, onProgress, signal, timeout = UPLOAD_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new FeedbackCancelled()); return; }
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    const request = new XMLHttpRequest();
    const cancel = () => request.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    request.onloadend = () => signal?.removeEventListener('abort', cancel);
    request.open('POST', `${String(url).replace(/\/$/, '')}/storage/v1/object/${FEEDBACK_BUCKET}/${encoded}`);
    request.timeout = timeout;
    request.setRequestHeader('authorization', `Bearer ${token}`);
    request.setRequestHeader('apikey', apiKey);
    request.setRequestHeader('x-upsert', 'true');
    request.setRequestHeader('cache-control', '3600');
    request.setRequestHeader('content-type', blob.type || 'image/jpeg');
    if (request.upload) request.upload.onprogress = event => {
      if (event.lengthComputable && event.total) onProgress?.(Math.round(event.loaded / event.total * 100));
    };
    request.onerror = () => reject(transient('The photo could not be uploaded. Check your connection and retry.'));
    request.ontimeout = () => reject(transient('The photo took too long to upload. Check your connection and retry.'));
    request.onabort = () => reject(new FeedbackCancelled());
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) { onProgress?.(100); resolve(); return; }
      let message = '';
      try { message = JSON.parse(request.responseText)?.message || ''; } catch { /* Non-JSON storage error. */ }
      const text = message || 'The photo could not be uploaded. Please retry.';
      reject(request.status >= 500 || request.status === 429 || request.status === 408 ? transient(text) : new Error(text));
    };
    request.send(blob);
  });
}
export async function uploadFeedbackPhoto({
  client, blob, objectKey, onProgress, signal, upload = storageUpload, cloud = config, retryDelay = RETRY_DELAY_MS,
}) {
  for (let attempt = 1; ; attempt += 1) {
    // Read each time: the session can refresh while an attempt is timing out.
    const { data, error } = await bounded(client.auth.getSession(), { signal });
    if (error) throw error;
    const accessToken = data?.session?.access_token;
    if (!accessToken) throw new Error('Your session expired. Sign in again to attach photos.');
    try {
      await upload({ url: cloud.url, apiKey: cloud.key, token: accessToken, path: objectKey, blob, onProgress, signal });
      return objectKey;
    } catch (caught) {
      if (!caught?.transient || attempt >= UPLOAD_ATTEMPTS) throw caught;
      onProgress?.(0);
      await bounded(new Promise(resolve => setTimeout(resolve, retryDelay)), { signal, ms: retryDelay + 1_000 });
    }
  }
}

// Asks instead of assuming: a row can be saved even when its response is lost.
async function attachmentRegistered(client, id) {
  try {
    const { data, error } = await bounded(client.from('feedback_attachments').select('id').eq('id', id).maybeSingle());
    return !error && Boolean(data);
  } catch {
    return false;
  }
}

export async function submitFeedbackTicket(client, {
  token, draft, diagnostics, attachments = [], state = {}, native = false, onEvent = () => {}, upload = storageUpload, signal,
}) {
  onEvent({ phase: 'ticket' });
  // Cancelling here leaves the draft on screen. The call may still arrive; sending
  // again uses the same token and returns that ticket.
  const { data, error } = await bounded(client.rpc('submit_feedback', feedbackArguments({ token, draft, diagnostics, state, native })), { signal });
  if (error) throw new Error(feedbackErrorMessage(error));
  const ticket = Array.isArray(data) ? data[0] : data;
  if (!ticket?.id) throw new Error('The server did not confirm your feedback. Please retry.');
  onEvent({ phase: 'ticket', ticket });
  let photoError = '';
  let cancelled = false;
  for (const attachment of attachments) {
    if (attachment.status === 'uploaded') continue;
    const objectKey = attachment.objectKey || `${ticket.owner_id}/${ticket.id}/${attachment.id}.jpg`;
    onEvent({ phase: 'photo', id: attachment.id, status: 'uploading', percent: 0 });
    try {
      await uploadFeedbackPhoto({
        client, blob: attachment.blob, objectKey, upload, signal,
        onProgress: percent => onEvent({ phase: 'photo', id: attachment.id, status: 'uploading', percent }),
      });
      // Not cancellable: a row that lands after its object was cleaned up would point at nothing.
      const { error: rowError } = await bounded(client.from('feedback_attachments').upsert({
        id: attachment.id, feedback_id: ticket.id, owner_id: ticket.owner_id, object_key: objectKey,
        byte_size: attachment.blob.size, width: attachment.width, height: attachment.height, mime_type: 'image/jpeg',
      }, { onConflict: 'id' }));
      if (rowError && !await attachmentRegistered(client, attachment.id)) throw new Error(feedbackErrorMessage(rowError));
      onEvent({ phase: 'photo', id: attachment.id, status: 'uploaded', percent: 100 });
    } catch (caught) {
      cancelled = caught instanceof FeedbackCancelled;
      const message = cancelled ? 'You cancelled the upload.' : caught?.message || 'The photo could not be uploaded. Please retry.';
      onEvent(cancelled ? { phase: 'photo', id: attachment.id, status: 'ready', percent: 0 } : { phase: 'photo', id: attachment.id, status: 'failed', error: message });
      photoError = message;
      // A failed upload may still have reached Storage, so anything unregistered is removed.
      // A registered photo keeps its object. If removal fails, a retry reuses the same key;
      // only an abandoned ticket leaves a file, which the orphan report in the docs finds.
      if (!await attachmentRegistered(client, attachment.id)) {
        try { await bounded(client.storage?.from?.(FEEDBACK_BUCKET)?.remove?.([objectKey])); } catch { /* Retry reuses the key. */ }
      }
      break;
    }
  }
  return { ticket, photoError, cancelled };
}

export async function loadFeedbackHistory(client, { limit = 50 } = {}) {
  const { data, error } = await client.from('feedback').select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) throw new Error('Your feedback could not be loaded. Please retry.');
  const tickets = data || [];
  if (!tickets.length) return [];
  const ids = tickets.map(ticket => ticket.id);
  const [messages, attachments] = await Promise.all([
    client.from('feedback_messages').select('*').in('feedback_id', ids).order('created_at', { ascending: true }),
    client.from('feedback_attachments').select('*').in('feedback_id', ids).order('created_at', { ascending: true }),
  ]);
  if (messages.error || attachments.error) throw new Error('Your feedback could not be loaded. Please retry.');
  let urls = {};
  const paths = (attachments.data || []).map(item => item.object_key);
  if (paths.length) {
    try {
      const { data: signed } = await client.storage.from(FEEDBACK_BUCKET).createSignedUrls(paths, 3600);
      urls = Object.fromEntries((signed || []).filter(item => item?.signedUrl).map(item => [item.path, item.signedUrl]));
    } catch { /* Thumbnails are optional evidence; the ticket still loads. */ }
  }
  return tickets.map(ticket => ({
    ...ticket,
    messages: (messages.data || []).filter(message => message.feedback_id === ticket.id),
    attachments: (attachments.data || []).filter(item => item.feedback_id === ticket.id)
      .map(item => ({ ...item, url: urls[item.object_key] || '' })),
  }));
}

// supabase-js reports a failed RPC in `error` rather than throwing. The caller gets the
// outcome: on failure the ticket stays unread on the server and is retried at the next open.
export async function markFeedbackSeen(client) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { error } = await client.rpc('mark_my_feedback_seen');
      if (!error) return true;
    } catch { /* Same as a returned error. */ }
  }
  return false;
}

