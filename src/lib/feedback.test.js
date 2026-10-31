import { describe, expect, it, vi } from 'vitest';
import {
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
    expect(result).toEqual({ ticket, photoError: '' });
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

  it('refuses photo uploads without a live session', async () => {
    const c = client({ auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }) } });
    await expect(uploadFeedbackPhoto({ client: c, blob: new Blob(['x']), objectKey: 'user-1/ticket/photo.jpg', upload: vi.fn() }))
      .rejects.toThrow(/session expired/i);
  });
});
