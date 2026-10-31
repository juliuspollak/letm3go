import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  auth: { status: 'authenticated', preferences: {}, session: { user: { id: 'user-1' } } },
  supabase: { rpc: vi.fn() },
  submit: vi.fn(),
  load: vi.fn(),
  seen: vi.fn(),
}));

vi.mock('../lib/AuthContext.jsx', () => ({ useAuth: () => m.auth }));
vi.mock('../lib/supabase.js', () => ({ supabase: m.supabase }));
vi.mock('../lib/feedback.js', async importOriginal => ({
  ...(await importOriginal()),
  submitFeedbackTicket: m.submit,
  loadFeedbackHistory: m.load,
  markFeedbackSeen: m.seen,
}));

import FeedbackSupport from './FeedbackSupport.jsx';
import { FeedbackCancelled } from '../lib/feedback.js';

const ticket = {
  id: '12345678-abcd-4abc-8abc-1234567890ab',
  category: 'bug',
  title: 'Map freezes on open',
  description: 'The map froze after I opened a journey.',
  status: 'open',
  created_at: '2026-10-30T09:00:00.000Z',
  updated_at: '2026-10-30T09:00:00.000Z',
  user_seen_at: null,
  messages: [{ id: 'message-1', feedback_id: '12345678-abcd-4abc-8abc-1234567890ab', is_staff: true, body: 'Looking into this now.', created_at: '2026-10-31T08:00:00.000Z' }],
  attachments: [],
};

beforeEach(() => {
  m.submit.mockReset();
  m.load.mockReset();
  m.seen.mockReset();
  m.supabase.rpc.mockReset();
});

afterEach(cleanup);

it('blocks an empty submission with field-level guidance', async () => {
  render(<FeedbackSupport />);
  const form = document.querySelector('form');
  fireEvent.click(within(form).getByRole('button', { name: 'Send feedback' }));
  expect(await screen.findByText('Choose what your feedback is about.')).toBeInTheDocument();
  expect(screen.getByText('Tell us what happened or what you need.')).toBeInTheDocument();
  expect(m.submit).not.toHaveBeenCalled();
});

it('sends the drafted ticket and shows a reference on the receipt', async () => {
  m.submit.mockResolvedValue({ ticket, photoError: '' });
  render(<FeedbackSupport />);
  fireEvent.click(screen.getByRole('radio', { name: /Bug report/ }));
  fireEvent.change(screen.getByLabelText(/What happened\?/), { target: { value: 'Opening a journey froze the map.' } });
  fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Map freezes' } });
  const form = document.querySelector('form');
  fireEvent.click(within(form).getByRole('button', { name: 'Send feedback' }));

  await waitFor(() => expect(m.submit).toHaveBeenCalledOnce());
  expect(m.submit.mock.calls[0][1]).toEqual(expect.objectContaining({
    draft: expect.objectContaining({ category: 'bug', title: 'Map freezes', description: 'Opening a journey froze the map.' }),
    diagnostics: null,
    attachments: [],
  }));
  expect(await screen.findByText(/Thank you/)).toBeInTheDocument();
  expect(screen.getByText('FB-12345678')).toBeInTheDocument();
  expect(screen.getByText(/A staff reply/)).toBeInTheDocument();
});

it('keeps a failed submission visible so the draft is not lost', async () => {
  m.submit.mockRejectedValue(new Error('Your session expired. Sign in again and retry.'));
  render(<FeedbackSupport />);
  fireEvent.click(screen.getByRole('radio', { name: /Feature idea/ }));
  fireEvent.change(screen.getByLabelText(/What happened\?/), { target: { value: 'Let me pin a favourite route.' } });
  fireEvent.click(within(document.querySelector('form')).getByRole('button', { name: 'Send feedback' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Your session expired');
  expect(screen.getByLabelText(/What happened\?/)).toHaveValue('Let me pin a favourite route.');
  expect(screen.queryByText(/Thank you/)).not.toBeInTheDocument();
});

it('loads ticket history, marks it seen and posts a reply', async () => {
  m.load.mockResolvedValue([ticket]);
  m.seen.mockResolvedValue(undefined);
  m.supabase.rpc.mockResolvedValue({ error: null });
  render(<FeedbackSupport />);
  fireEvent.click(screen.getByRole('button', { name: 'My feedback' }));

  expect(await screen.findByText('Map freezes on open')).toBeInTheDocument();
  expect(screen.getByText('New reply')).toBeInTheDocument();
  expect(m.seen).toHaveBeenCalledWith(m.supabase);

  fireEvent.click(screen.getByRole('button', { name: /Map freezes on open/ }));
  expect(screen.getByText(/Reference FB-12345678/)).toBeInTheDocument();
  expect(screen.getByText('Looking into this now.')).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText(/Reply/), { target: { value: 'It happens on every journey.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
  await waitFor(() => expect(m.supabase.rpc).toHaveBeenCalledWith('add_feedback_message', {
    p_feedback_id: ticket.id,
    p_body: 'It happens on every journey.',
  }));
  expect(await screen.findByText('It happens on every journey.')).toBeInTheDocument();
  expect(screen.getByLabelText(/Reply/)).toHaveValue('');
});

it('shows an empty state when the account has no feedback yet', async () => {
  m.load.mockResolvedValue([]);
  render(<FeedbackSupport />);
  fireEvent.click(screen.getByRole('button', { name: 'My feedback' }));
  expect(await screen.findByText('Nothing here yet')).toBeInTheDocument();
  expect(m.seen).not.toHaveBeenCalled();
});

it('keeps help topics available without an account connection', () => {
  render(<FeedbackSupport />);
  fireEvent.click(screen.getByRole('button', { name: 'Help' }));
  expect(screen.getByText('Try these first')).toBeInTheDocument();
  expect(screen.getByText('Notifications are not arriving')).toBeInTheDocument();
  expect(screen.getByText(/Enable notifications for letm3go/)).toBeInTheDocument();
});

it('clears the tab indicator once the receipt is saved, and the ticket label once it is read', async () => {
  m.load.mockResolvedValue([ticket]);
  m.seen.mockResolvedValue(true);
  render(<FeedbackSupport />);
  fireEvent.click(screen.getByRole('button', { name: 'My feedback' }));
  expect(await screen.findByText('Map freezes on open')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByLabelText('Unread reply')).not.toBeInTheDocument());
  expect(screen.getByText('New reply')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Map freezes on open/ }));
  expect(screen.queryByText('New reply')).not.toBeInTheDocument();
});

it('keeps the unread indicator when the receipt could not be saved', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  m.load.mockResolvedValue([ticket]);
  m.seen.mockResolvedValue(false);
  render(<FeedbackSupport />);
  fireEvent.click(screen.getByRole('button', { name: 'My feedback' }));
  await waitFor(() => expect(warn).toHaveBeenCalled());
  expect(screen.getByLabelText('Unread reply')).toBeInTheDocument();
  warn.mockRestore();
});

it('fetches new links when a signed photo has expired, once however many images break', async () => {
  const withPhoto = { ...ticket, attachments: [{ id: 'p', url: 'https://storage/expired' }, { id: 'q', url: 'https://storage/expired2' }] };
  m.load.mockResolvedValueOnce([withPhoto]).mockResolvedValue([{ ...withPhoto, attachments: [{ id: 'p', url: 'https://storage/fresh' }, { id: 'q', url: 'https://storage/fresh2' }] }]);
  m.seen.mockResolvedValue(true);
  render(<FeedbackSupport />);
  fireEvent.click(screen.getByRole('button', { name: 'My feedback' }));
  fireEvent.click(await screen.findByRole('button', { name: /Map freezes on open/ }));
  const images = screen.getAllByRole('img', { name: /Attachment/ });
  fireEvent.error(images[0]);
  fireEvent.error(images[1]);
  await waitFor(() => expect(screen.getAllByRole('img', { name: /Attachment/ })[0]).toHaveAttribute('src', 'https://storage/fresh'));
  expect(m.load).toHaveBeenCalledTimes(2);
});

it('cancels a send in progress and keeps the draft, ready to send with the same token', async () => {
  m.submit.mockImplementationOnce((_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new FeedbackCancelled()))));
  m.submit.mockResolvedValueOnce({ ticket, photoError: '' });
  render(<FeedbackSupport />);
  fireEvent.click(screen.getByRole('radio', { name: /Bug report/ }));
  fireEvent.change(screen.getByLabelText(/What happened\?/), { target: { value: 'It froze.' } });
  fireEvent.click(within(document.querySelector('form')).getByRole('button', { name: 'Send feedback' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Your draft is still here');
  expect(screen.getByLabelText(/What happened\?/)).toHaveValue('It froze.');
  fireEvent.click(within(document.querySelector('form')).getByRole('button', { name: 'Send feedback' }));
  await screen.findByText(/Thank you/);
  expect(m.submit.mock.calls[1][1].token).toBe(m.submit.mock.calls[0][1].token);
});

it('abandons a send when the sheet closes, and creates one token per draft', async () => {
  const token = vi.spyOn(globalThis.crypto, 'randomUUID');
  m.submit.mockImplementation(() => new Promise(() => {}));
  const { unmount, rerender } = render(<FeedbackSupport />);
  rerender(<FeedbackSupport />);
  rerender(<FeedbackSupport />);
  expect(token).toHaveBeenCalledTimes(1);
  token.mockRestore();
  fireEvent.click(screen.getByRole('radio', { name: /Bug report/ }));
  fireEvent.change(screen.getByLabelText(/What happened\?/), { target: { value: 'It froze.' } });
  fireEvent.click(within(document.querySelector('form')).getByRole('button', { name: 'Send feedback' }));
  await waitFor(() => expect(m.submit).toHaveBeenCalled());
  const { signal } = m.submit.mock.calls[0][1];
  expect(signal.aborted).toBe(false);
  unmount();
  expect(signal.aborted).toBe(true);
});
