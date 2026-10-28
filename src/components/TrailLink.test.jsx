import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import * as mtbApi from '../lib/mtbApi.js';
import TrailLink from './TrailLink.jsx';

vi.mock('../lib/mtbApi.js', () => ({ fetchTrails: vi.fn() }));
afterEach(cleanup);

const trail = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Fern Gully',
  geometry: [[0, 0], [0, 0.002]],
  distance_meters: 2400,
  difficulty: 'black',
  access: 'sanctioned',
};
const ride = { id: 'ride-1', activity: 'MTB', source: 'device', state: 'finished', route: [[0, 0], [0, 0.001]] };

it('finds nearby trails and links the chosen one with the native payload', async () => {
  mtbApi.fetchTrails.mockResolvedValue([trail]);
  const perform = vi.fn().mockResolvedValue(true);
  render(<TrailLink trip={ride} perform={perform} busy={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Find nearby trails' }));
  const option = await screen.findByRole('button', { name: /Fern Gully/ });
  expect(option).toHaveTextContent('2.4 km');
  expect(option).toHaveTextContent('Black');
  expect(option).toHaveTextContent('starts 0 m from this ride');
  fireEvent.click(option);
  await waitFor(() => expect(perform).toHaveBeenCalledWith('assignTrail', {
    id: 'ride-1',
    trailID: trail.id,
    trailName: 'Fern Gully',
    trailSegmentID: undefined,
    trailDistanceMeters: 2400,
  }));
  expect(await screen.findByText('Linked to Fern Gully.')).toBeInTheDocument();
});

it('shows the existing link privately and unlinks it with only the activity id', async () => {
  const perform = vi.fn().mockResolvedValue(true);
  const linked = { ...ride, trail: { id: trail.id, name: 'Fern Gully', segmentID: null, distanceMeters: 2400 } };
  render(<TrailLink trip={linked} perform={perform} busy={false} />);
  expect(screen.getByText('Fern Gully · 2.4 km')).toBeInTheDocument();
  expect(screen.getByText('Linked')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Remove link/ }));
  await waitFor(() => expect(perform).toHaveBeenCalledWith('assignTrail', { id: 'ride-1' }));
});

it('explains an offline or failed lookup instead of pretending a trail exists', async () => {
  mtbApi.fetchTrails.mockRejectedValue(new Error('Trails unavailable.'));
  render(<TrailLink trip={ride} perform={vi.fn()} busy={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Find nearby trails' }));
  expect(await screen.findByText('Trails unavailable.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Fern Gully/ })).not.toBeInTheDocument();
});

it('does not search when the ride has no GPS route', async () => {
  mtbApi.fetchTrails.mockClear();
  render(<TrailLink trip={{ ...ride, route: [] }} perform={vi.fn()} busy={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Find nearby trails' }));
  expect(await screen.findByRole('status')).toHaveTextContent('This ride has no GPS route to search near.');
  expect(mtbApi.fetchTrails).not.toHaveBeenCalled();
});

it('keeps a failed lookup retryable instead of showing an empty catalogue', async () => {
  mtbApi.fetchTrails.mockReset();
  mtbApi.fetchTrails.mockRejectedValueOnce(new Error('You appear to be offline.')).mockResolvedValueOnce([trail]);
  render(<TrailLink trip={ride} perform={vi.fn()} busy={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Find nearby trails' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('You appear to be offline.');
  expect(screen.queryByText('No community trails found near this ride yet.')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Fern Gully/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('button', { name: /Fern Gully/ })).toBeInTheDocument();
  expect(mtbApi.fetchTrails).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('says so when a successful search finds no trails, without offering a pointless retry', async () => {
  mtbApi.fetchTrails.mockReset();
  mtbApi.fetchTrails.mockResolvedValue([]);
  render(<TrailLink trip={ride} perform={vi.fn()} busy={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Find nearby trails' }));
  expect(await screen.findByText('No community trails found near this ride yet.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  // An empty result is still a result: reopening the list does not refetch.
  fireEvent.click(screen.getByRole('button', { name: 'Find nearby trails' }));
  expect(mtbApi.fetchTrails).toHaveBeenCalledTimes(1);
});

it('searches again for a different ride instead of reusing the previous list', async () => {
  mtbApi.fetchTrails.mockReset();
  mtbApi.fetchTrails.mockResolvedValue([trail]);
  const perform = vi.fn().mockResolvedValue(true);
  const { rerender } = render(<TrailLink trip={ride} perform={perform} busy={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Find nearby trails' }));
  await screen.findByRole('button', { name: /Fern Gully/ });
  rerender(<TrailLink trip={{ ...ride, id: 'ride-2' }} perform={perform} busy={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Find nearby trails' }));
  await waitFor(() => expect(mtbApi.fetchTrails).toHaveBeenCalledTimes(2));
  fireEvent.click(await screen.findByRole('button', { name: /Fern Gully/ }));
  await waitFor(() => expect(perform).toHaveBeenCalledWith('assignTrail', expect.objectContaining({ id: 'ride-2', trailID: trail.id })));
});
