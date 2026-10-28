import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import MtbMap from './MtbMap.jsx';

vi.mock('../lib/AuthContext.jsx', () => ({ useAuth: () => ({ identity: { status: 'authenticated' } }) }));
vi.mock('../lib/supabase.js', () => ({ supabase: null }));
vi.mock('../lib/mtbApi.js', () => ({ mySubmissions: vi.fn().mockResolvedValue([]), moderationQueue: vi.fn().mockResolvedValue([]) }));
vi.mock('./AppleMap.jsx', () => ({ default: () => <div aria-label="Apple Map" /> }));
const trail = { id: '11111111-1111-4111-8111-111111111111', name: 'Fern Gully', distance_meters: 2400, direction: 'downhill', difficulty: 'black', access: 'sanctioned', status: 'approved', geometry: [[0, 0], [0, 0.002]], kind: 'trail' };
vi.mock('../lib/useMtbMap.js', () => ({ useMtbMap: () => ({ trails: [trail], segments: [], loading: false, error: '' }) }));
afterEach(cleanup);

it('starts a mountain-bike recording already linked to the opened trail', () => {
  const onRecordTrail = vi.fn();
  render(<MtbMap currentPosition={{ latitude: 0, longitude: 0 }} onRecordTrail={onRecordTrail} />);
  fireEvent.click(screen.getByRole('button', { name: 'Fern Gully · 2.4 km' }));
  fireEvent.click(screen.getByRole('button', { name: 'Record this trail' }));
  expect(onRecordTrail).toHaveBeenCalledWith(expect.objectContaining({ id: trail.id, name: 'Fern Gully', kind: 'trail' }));
});

it('does not offer a trail recording where the platform cannot record one', () => {
  render(<MtbMap currentPosition={null} />);
  fireEvent.click(screen.getByRole('button', { name: 'Fern Gully · 2.4 km' }));
  expect(screen.queryByRole('button', { name: 'Record this trail' })).not.toBeInTheDocument();
});
