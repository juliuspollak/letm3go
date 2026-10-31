import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedbackCancelled, MAX_IMAGE_BYTES, REQUEST_TIMEOUT_MS, UPLOAD_TIMEOUT_MS, feedbackMarkedSeen, markFeedbackSeen, storageUpload,
  emptyFeedbackDraft, feedbackArguments, feedbackDiagnostics, feedbackErrors, feedbackHasUnread,
  feedbackReference, newFeedbackToken, submitFeedbackTicket, uploadFeedbackPhoto,
} from './feedback.js';

const ticket = { id: '12345678-abcd-4abc-8abc-1234567890ab', owner_id: 'user-1' };

describe('feedback validation and snapshots', () => {
  it('requires a category and a description but keeps the title optional', () => {
    expect(feedbackErrors(emptyFeedbackDraft())).toEqual({
      category: 'Choose what your feedback is about.',
      description: 'Tell us what happened or what you need.',
    });
    expect(feedbackErrors({ category: 'bug', title: 'x'.repeat(121), description: 'Broken map' })).toEqual({ title: 'Keep the title under 120 characters.' });
    expect(feedbackErrors({ category: 'bug', title: 'Broken map', description: 'x'.repeat(4001) })).toEqual({ description: 'Keep it under 4,000 characters.' });
    expect(feedbackErrors({ category: 'bug', title: '', description: '  Broken map  ' })).toEqual({});
  });

  it('never puts routes, coordinates, email or ids in the diagnostic snapshot', () => {
    const snapshot = feedbackDiagnostics({
      state: {
        version: '1.2.3', build: '45', permission: 'granted', precise: true, storageReady: true,
        trips: [{ id: 'trip-1', route: [[1, 2], [3, 4]] }], routes: [{ coordinates: [1, 2] }],
        savedPlaces: [{ lat: 1, lng: 2 }], email: 'rider@example.com',
      },
      preferences: { lastBackup: '2026-10-01T00:00:00.000Z', email: 'rider@example.com' },
      session: { user: { id: 'user-1', email: 'rider@example.com' } },
      native: true,
    });
    const serialized = JSON.stringify(snapshot);
    expect(snapshot).toMatchObject({ schema: 1, platform: 'ios', recording: { trips: 1, permission: 'granted' }, cloud: { signedIn: true } });
    expect(serialized).not.toMatch(/route|coordinates|savedPlaces|rider@example|user-1/i);
  });

  it('trims the submitted arguments and only sends diagnostics when opted in', () => {
    const args = feedbackArguments({
      token: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      draft: { category: 'bug', title: '  Map  ', description: '  It froze  ', whatHappened: '', expected: '  Panning  ', steps: '  ' },
      diagnostics: null, state: { version: '1.2.3', build: '45' }, native: false,
    });
    expect(args).toEqual({
      p_client_token: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', p_category: 'bug', p_title: 'Map', p_description: 'It froze',
      p_what_happened: null, p_expected_behaviour: 'Panning', p_steps_to_reproduce: null, p_diagnostics: null,
      p_app_version: '1.2.3', p_build_number: '45', p_platform: 'web',
    });
  });

  it('makes stable references and detects unread staff replies', () => {
    expect(feedbackReference(ticket)).toBe('FB-12345678');
    expect(feedbackReference(null)).toBe('FB-PENDING');
    expect(newFeedbackToken()).toMatch(/^[0-9a-f-]{36}$/);
    expect(feedbackHasUnread({ user_seen_at: null, messages: [{ is_staff: true, created_at: '2026-10-01T00:00:00Z' }] })).toBe(true);
    expect(feedbackHasUnread({ user_seen_at: '2026-10-02T00:00:00Z', messages: [{ is_staff: true, created_at: '2026-10-01T00:00:00Z' }] })).toBe(false);
  });
});

describe('feedback submission pipeline', () => {
  const client = (overrides = {}) => ({
    rpc: vi.fn().mockResolvedValue({ data: ticket, error: null }),
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'token' } }, error: null }) },
    from: vi.fn(() => ({ upsert: vi.fn().mockResolvedValue({ error: null }) })),
    storage: { from: vi.fn(() => ({ remove: vi.fn().mockResolvedValue({ error: null }) })) },
    ...overrides,
  });
  const draft = { category: 'bug', title: 'Map', description: 'It froze', whatHappened: '', expected: '', steps: '' };
  const token = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  it('creates the ticket first, then uploads each photo with progress', async () => {
    const c = client();
    const upload = vi.fn(async ({ onProgress }) => { onProgress?.(40); onProgress?.(100); });
    const events = [];
    const attachment = { id: 'photo-1', blob: new Blob(['image'], { type: 'image/jpeg' }), width: 10, height: 8, status: 'ready', percent: 0 };
    const result = await submitFeedbackTicket(c, { token, draft, attachments: [attachment], onEvent: event => events.push(event), upload });
    expect(c.rpc).toHaveBeenCalledWith('submit_feedback', expect.objectContaining({ p_client_token: token }));
    expect(upload.mock.calls[0][0]).toEqual(expect.objectContaining({ token: 'token', path: 'user-1/12345678-abcd-4abc-8abc-1234567890ab/photo-1.jpg' }));
    expect(c.from).toHaveBeenCalledWith('feedback_attachments');
    expect(c.from.mock.results[0].value.upsert).toHaveBeenCalledWith(expect.objectContaining({
      object_key: 'user-1/12345678-abcd-4abc-8abc-1234567890ab/photo-1.jpg', byte_size: 5,
    }), { onConflict: 'id' });
    expect(events.map(event => event.status).filter(Boolean)).toEqual(['uploading', 'uploading', 'uploading', 'uploaded']);
    expect(result).toEqual({ ticket, photoError: '', cancelled: false });
  });

  it('keeps the ticket when a photo fails and cleans up the partial object', async () => {
    const remove = vi.fn().mockResolvedValue({ error: null });
    const c = client({ storage: { from: vi.fn(() => ({ remove })) } });
    const events = [];
    const attachment = { id: 'photo-1', blob: new Blob(['image']), width: 10, height: 8, status: 'ready' };
    const result = await submitFeedbackTicket(c, {
      token, draft, attachments: [attachment], onEvent: event => events.push(event),
      upload: vi.fn().mockRejectedValue(new Error('Offline')),
    });
    expect(result.ticket).toBe(ticket);
    expect(result.photoError).toBe('Offline');
    expect(remove).toHaveBeenCalledWith(['user-1/12345678-abcd-4abc-8abc-1234567890ab/photo-1.jpg']);
    expect(events.at(-1)).toMatchObject({ status: 'failed', error: 'Offline' });
  });

  it('treats a saved row as success when only its response was lost, and keeps the photo', async () => {
    const remove = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn(() => ({
      upsert: vi.fn().mockResolvedValue({ error: { message: 'network timeout' } }),
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'photo-1' }, error: null }) }) }),
    }));
    const events = [];
    const attachment = { id: 'photo-1', blob: new Blob(['image']), width: 10, height: 8, status: 'ready' };
    const result = await submitFeedbackTicket(client({ from, storage: { from: vi.fn(() => ({ remove })) } }), {
      token, draft, attachments: [attachment], onEvent: event => events.push(event), upload: vi.fn().mockResolvedValue(),
    });
    expect(result.photoError).toBe('');
    expect(remove).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ status: 'uploaded' });
  });

  it('removes the stored photo when its row really was not saved', async () => {
    const remove = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn(() => ({
      upsert: vi.fn().mockResolvedValue({ error: { message: 'A feedback ticket can have up to 5 photos.' } }),
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }));
    const attachment = { id: 'photo-1', blob: new Blob(['image']), width: 10, height: 8, status: 'ready' };
    const result = await submitFeedbackTicket(client({ from, storage: { from: vi.fn(() => ({ remove })) } }), {
      token, draft, attachments: [attachment], upload: vi.fn().mockResolvedValue(),
    });
    expect(result.photoError).toMatch(/up to 5/);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('reports a read receipt that failed, including an error supabase-js returns without throwing', async () => {
    expect(await markFeedbackSeen({ rpc: vi.fn().mockResolvedValue({ error: null }) })).toBe(true);
    const failing = { rpc: vi.fn().mockResolvedValue({ error: { message: 'denied' } }) };
    expect(await markFeedbackSeen(failing)).toBe(false);
    expect(failing.rpc).toHaveBeenCalledTimes(2);
    expect(await markFeedbackSeen({ rpc: vi.fn().mockRejectedValue(new Error('offline')) })).toBe(false);
  });

  it('refuses photo uploads without a live session', async () => {
    const c = client({ auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }) } });
    await expect(uploadFeedbackPhoto({ client: c, blob: new Blob(['x']), objectKey: 'user-1/ticket/photo.jpg', upload: vi.fn() }))
      .rejects.toThrow(/session expired/i);
  });
});

describe('bounded, retryable and cancellable sending', () => {
  class FakeRequest {
    static sent = [];
    upload = {};
    headers = {};
    open(method, url) { this.url = url; }
    setRequestHeader(name, value) { this.headers[name] = value; }
    send() { FakeRequest.sent.push(this); }
    abort() { this.onabort?.(); this.onloadend?.(); }
  }
  const upload = options => storageUpload({ url: 'https://x', apiKey: 'k', token: 't', path: 'a/b/c.jpg', blob: { type: 'image/jpeg' }, ...options });
  const uploadClient = () => ({ auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 't' } } })) } });

  beforeEach(() => { FakeRequest.sent = []; vi.stubGlobal('XMLHttpRequest', FakeRequest); });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('gives every upload a time limit and reports running out of it', async () => {
    const pending = upload();
    const [request] = FakeRequest.sent;
    expect(request.timeout).toBe(UPLOAD_TIMEOUT_MS);
    request.ontimeout();
    await expect(pending).rejects.toMatchObject({ transient: true, message: expect.stringContaining('too long') });
  });

  it('aborts the request when the person cancels, and refuses to start after it', async () => {
    const controller = new AbortController();
    const pending = upload({ signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(FeedbackCancelled);
    await expect(upload({ signal: controller.signal })).rejects.toBeInstanceOf(FeedbackCancelled);
    expect(FakeRequest.sent).toHaveLength(1);
  });

  it('treats a server fault as worth a retry and a refusal as final', async () => {
    const fault = upload();
    Object.assign(FakeRequest.sent[0], { status: 503, responseText: '' }).onload();
    await expect(fault).rejects.toMatchObject({ transient: true });
    const refused = upload();
    Object.assign(FakeRequest.sent[1], { status: 403, responseText: '{"message":"new row violates row-level security"}' }).onload();
    await expect(refused).rejects.not.toHaveProperty('transient');
  });

  it('retries a lost attempt once with the same key, then gives up', async () => {
    const lost = Object.assign(new Error('lost'), { transient: true });
    const again = vi.fn().mockRejectedValueOnce(lost).mockResolvedValueOnce();
    await uploadFeedbackPhoto({ client: uploadClient(), blob: {}, objectKey: 'k', upload: again, retryDelay: 1 });
    expect(again.mock.calls.map(([call]) => call.path)).toEqual(['k', 'k']);
    const never = vi.fn().mockRejectedValue(lost);
    await expect(uploadFeedbackPhoto({ client: uploadClient(), blob: {}, objectKey: 'k', upload: never, retryDelay: 1 })).rejects.toBe(lost);
    expect(never).toHaveBeenCalledTimes(2);
  });

  it('does not retry a refusal, or a cancellation', async () => {
    const refused = vi.fn().mockRejectedValue(new Error('refused'));
    await expect(uploadFeedbackPhoto({ client: uploadClient(), blob: {}, objectKey: 'k', upload: refused, retryDelay: 1 })).rejects.toThrow('refused');
    expect(refused).toHaveBeenCalledOnce();
    const stopped = vi.fn().mockRejectedValue(new FeedbackCancelled());
    await expect(uploadFeedbackPhoto({ client: uploadClient(), blob: {}, objectKey: 'k', upload: stopped, retryDelay: 1 })).rejects.toBeInstanceOf(FeedbackCancelled);
    expect(stopped).toHaveBeenCalledOnce();
  });

  it('stops waiting for a ticket call that never answers, and keeps the token for the retry', async () => {
    vi.useFakeTimers();
    const client = { rpc: vi.fn(() => new Promise(() => {})) };
    const sent = submitFeedbackTicket(client, { token: 'draft-token', draft: { category: 'bug', description: 'x' } });
    const failed = expect(sent).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await failed;
    expect(client.rpc.mock.calls[0][1].p_client_token).toBe('draft-token');
  });

  it('keeps a saved ticket when a photo is cancelled, puts the photo back and removes its file', async () => {
    const remove = vi.fn(async () => ({}));
    const client = {
      ...uploadClient(),
      rpc: vi.fn(async () => ({ data: ticket })),
      from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) })),
      storage: { from: () => ({ remove }) },
    };
    const controller = new AbortController();
    const events = [];
    const outcome = await submitFeedbackTicket(client, {
      token: 't', draft: { category: 'bug', description: 'x' }, signal: controller.signal,
      attachments: [{ id: 'p1', blob: { size: 1 }, width: 1, height: 1 }, { id: 'p2', blob: { size: 1 }, width: 1, height: 1 }],
      onEvent: event => events.push(event),
      upload: async () => { controller.abort(); throw new FeedbackCancelled(); },
    });
    expect(outcome).toMatchObject({ ticket, cancelled: true, photoError: 'You cancelled the upload.' });
    expect(events.at(-1)).toMatchObject({ id: 'p1', status: 'ready' });
    expect(events.some(event => event.id === 'p2')).toBe(false);
    expect(remove).toHaveBeenCalledOnce();
  });

  it('allows the full size the bucket accepts', () => {
    expect(MAX_IMAGE_BYTES).toBe(10485760);
  });
});

describe('read state', () => {
  const reply = { is_staff: true, created_at: '2026-10-31T08:00:00.000Z' };
  it('clears unread once marked, even with a device clock behind the server', () => {
    const [marked] = feedbackMarkedSeen([{ id: 't', user_seen_at: null, messages: [reply] }]);
    expect(feedbackHasUnread(marked)).toBe(false);
    expect(marked.freshReply).toBe(true);
  });
  it('leaves tickets with nothing new alone', () => {
    const quiet = { id: 't', user_seen_at: '2026-10-31T09:00:00.000Z', messages: [reply] };
    expect(feedbackMarkedSeen([quiet])[0]).toBe(quiet);
  });
});
