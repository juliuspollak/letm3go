import { expect, it, vi } from 'vitest';

const { native } = vi.hoisted(() => ({ native: { start: vi.fn(), assignTrail: vi.fn() } }));
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'ios' }, registerPlugin: () => native }));
const { recorder } = await import('./recorder.js');

const trailID = '11111111-1111-4111-8111-111111111111';

it('passes an optional trail link when a mountain-bike ride starts', async () => {
  native.start.mockResolvedValue({ trips: [] });
  await recorder.start('MTB', 'Trek', 'bike-1', { id: trailID, name: 'Fern Gully', distanceMeters: 2400 });
  expect(native.start).toHaveBeenCalledWith({
    activity: 'MTB', vehicle: 'Trek', vehicleID: 'bike-1',
    trailID, trailName: 'Fern Gully', trailSegmentID: undefined, trailDistanceMeters: 2400,
  });
});

it('starts an ordinary activity with no trail arguments at all', async () => {
  native.start.mockResolvedValue({ trips: [] });
  await recorder.start('Walking');
  const args = native.start.mock.calls.at(-1)[0];
  expect(args).toEqual({ activity: 'Walking', vehicle: undefined, vehicleID: undefined });
  expect('trailID' in args).toBe(false);
});

it('writes and clears the trail link through the native recorder', async () => {
  native.assignTrail.mockResolvedValue({ trips: [] });
  await recorder.assignTrail({ id: 'ride-1', trailID, trailName: 'Fern Gully' });
  expect(native.assignTrail).toHaveBeenCalledWith({ id: 'ride-1', trailID, trailName: 'Fern Gully' });
  await recorder.assignTrail({ id: 'ride-1' });
  expect(native.assignTrail).toHaveBeenLastCalledWith({ id: 'ride-1' });
});
