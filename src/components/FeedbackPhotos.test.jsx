import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ prepare: vi.fn() }));
vi.mock('../lib/feedbackImage.js', () => ({ prepareFeedbackImage: m.prepare }));

import FeedbackPhotos from './FeedbackPhotos.jsx';

const photo = { id: 'photo-1', previewUrl: 'blob:preview-1', status: 'ready', percent: 0, width: 100, height: 80 };

beforeEach(() => {
  m.prepare.mockReset();
  m.prepare.mockResolvedValue({ blob: new Blob(['image'], { type: 'image/jpeg' }), width: 100, height: 80 });
  URL.createObjectURL = vi.fn(() => 'blob:preview-1');
  URL.revokeObjectURL = vi.fn();
});

afterEach(cleanup);

it('prepares a picked image and reports it to the parent', async () => {
  const onAdd = vi.fn();
  const { container } = render(<FeedbackPhotos photos={[]} onAdd={onAdd} onRemove={vi.fn()} onView={vi.fn()} />);
  const library = container.querySelectorAll('input[type="file"]')[1];
  fireEvent.change(library, { target: { files: [new File(['raw'], 'screenshot.png', { type: 'image/png' })] } });
  await waitFor(() => expect(onAdd).toHaveBeenCalledOnce());
  expect(m.prepare).toHaveBeenCalledWith(expect.any(File));
  expect(onAdd.mock.calls[0][0][0]).toEqual(expect.objectContaining({ previewUrl: 'blob:preview-1', status: 'ready' }));
});

it('surfaces an unreadable image without adding it', async () => {
  m.prepare.mockRejectedValue(new Error('That image is too large. Choose one under 10 MB.'));
  const onAdd = vi.fn();
  const { container } = render(<FeedbackPhotos photos={[]} onAdd={onAdd} onRemove={vi.fn()} onView={vi.fn()} />);
  fireEvent.change(container.querySelectorAll('input[type="file"]')[1], { target: { files: [new File(['raw'], 'huge.png', { type: 'image/png' })] } });
  expect(await screen.findByRole('alert')).toHaveTextContent('too large');
  expect(onAdd).not.toHaveBeenCalled();
});

it('opens and removes an existing attachment', () => {
  const onView = vi.fn(), onRemove = vi.fn();
  render(<FeedbackPhotos photos={[photo]} onAdd={vi.fn()} onRemove={onRemove} onView={onView} />);
  fireEvent.click(screen.getByRole('button', { name: 'View photo 1' }));
  expect(onView).toHaveBeenCalledWith(0);
  fireEvent.click(screen.getByRole('button', { name: 'Remove photo 1' }));
  expect(onRemove).toHaveBeenCalledWith('photo-1');
});

it('stops at five photos', () => {
  const photos = Array.from({ length: 5 }, (_, index) => ({ ...photo, id: `photo-${index + 1}` }));
  render(<FeedbackPhotos photos={photos} onAdd={vi.fn()} onRemove={vi.fn()} onView={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Take photo' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Choose photos' })).toBeDisabled();
  expect(screen.getByText(/maximum of 5 photos/)).toBeInTheDocument();
});
