import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ platform: 'ios', getState: vi.fn() }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => m.platform, isNativePlatform: () => m.platform === 'ios' },
  registerPlugin: () => m,
}));
import { emptyRecorder, recorder, recorderAvailable } from './recorder.js';

beforeEach(() => { m.platform = 'ios'; });

// `getState` is the single read every screen depends on: History, the recorder
// panel, the watch inbox import and private sharing all start here. These tests
// pin the bridge contract itself (a snapshot is forwarded untouched, a native
// failure is never turned into an empty list, and the web build never pretends
// native storage exists) so a change in plugin wiring fails here, not on a ride.

it('forwards the native snapshot untouched', async () => {
  const snapshot = {
    ownerID: 'OWNER-1', trips: [{ id: 'ride', state: 'finished' }], places: [],
    permission: 'always', storageReady: true, version: '2.4', build: '412',
    watchInbox: { pending: 1 }, deletedIDs: [],
  };
  m.getState.mockResolvedValue(snapshot);
  expect(recorderAvailable()).toBe(true);
  expect(await recorder.getState()).toBe(snapshot);
  expect(m.getState).toHaveBeenCalledTimes(1);
  expect(m.getState).toHaveBeenCalledWith();
});

it('surfaces a failed native read instead of inventing an empty recorder', async () => {
  m.getState.mockRejectedValue(new Error('ManualRecorder bridge unavailable'));
  await expect(recorder.getState()).rejects.toThrow('ManualRecorder bridge unavailable');
});

it('reports an unavailable, unready recorder on the web build', async () => {
  m.platform = 'web';
  expect(recorderAvailable()).toBe(false);
  const state = await recorder.getState();
  expect(state).toBe(emptyRecorder);
  expect(state).toMatchObject({ trips: [], active: null, permission: 'unavailable', storageReady: false, build: 'web' });
  expect(m.getState).not.toHaveBeenCalled();
});
