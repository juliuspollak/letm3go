import { webcrypto } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { mergeRestoredSettings, settingsPayload, syncAccountSettings } from './settingsSync.js';
const owner = '11111111-1111-4111-8111-111111111111';
const preferences = () => ({ displayName: 'Jules', avatar: 'data:image/jpeg;base64,AAAA', distanceUnit: 'mi', notificationsEnabled: true, bookmarks: ['trip-1'], archivedTrips: ['trip-2'], journeyGrouping: '{"version":1,"owner":"11111111-1111-4111-8111-111111111111"}', vehicles: [{ id: 'v' }], syncReceipts: { trip: { owner } } });

it('exports only settings, never vehicles or per-device receipts', () => {
  const payload = settingsPayload({ ...preferences(), demoOverrides: 'secret', password: 'nope', notificationsEnabled: false });
  expect(Object.keys(payload).sort()).toEqual(['archivedTrips', 'avatar', 'bookmarks', 'displayName', 'distanceUnit', 'journeyGrouping', 'notificationsEnabled']);
  expect(payload.notificationsEnabled).toBe(false);
  expect(settingsPayload({ bookmarks: 'nope', archivedTrips: [1, 'ok'], displayName: '  ' })).toMatchObject({ bookmarks: [], archivedTrips: ['ok'] });
});

it('backs up once per fingerprint and surfaces a backend failure', async () => {
  const api = { rpc: vi.fn().mockResolvedValue({ data: 1, error: null }) };
  const checkpoint = vi.fn();
  const first = await syncAccountSettings(api, { owner, preferences: preferences() }, { cryptoImpl: webcrypto, checkpoint });
  expect(api.rpc).toHaveBeenCalledWith('backup_account_settings', expect.objectContaining({ p_owner: owner, p_expected_revision: null, p_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) }));
  expect(first.uploaded).toBe(1);
  expect(checkpoint).toHaveBeenCalledOnce();
  api.rpc.mockClear();
  await syncAccountSettings(api, { owner, preferences: preferences(), receipts: first.receipts }, { cryptoImpl: webcrypto });
  expect(api.rpc).not.toHaveBeenCalled();
  api.rpc.mockResolvedValue({ error: { code: 'PGRST202' } });
  await expect(syncAccountSettings(api, { owner, preferences: { ...preferences(), displayName: 'Changed' } }, { cryptoImpl: webcrypto })).rejects.toThrow('migration');
});

it('refuses a settings receipt that belongs to another account', async () => {
  const api = { rpc: vi.fn() };
  await expect(syncAccountSettings(api, { owner, preferences: preferences(), receipts: { settings: { owner: 'someone-else', fingerprint: 'a'.repeat(64) } } }, { cryptoImpl: webcrypto })).rejects.toThrow('another account');
  expect(api.rpc).not.toHaveBeenCalled();
});

it('merges a restore additively and never blanks a local value', () => {
  const patch = mergeRestoredSettings(
    { displayName: 'Local', avatar: null, distanceUnit: 'km', notificationsEnabled: false, bookmarks: ['a'], archivedTrips: ['one'], journeyGrouping: '' },
    { displayName: 'Cloud', avatar: 'data:image/jpeg;base64,QQ==', distanceUnit: 'mi', notificationsEnabled: true, bookmarks: ['a', 'b'], archivedTrips: ['one', 'two'], journeyGrouping: '{"version":1}' },
  );
  expect(patch).toEqual({ avatar: 'data:image/jpeg;base64,QQ==', distanceUnit: 'mi', bookmarks: ['a', 'b'], archivedTrips: ['one', 'two'], journeyGrouping: '{"version":1}' });
  expect(mergeRestoredSettings({ displayName: 'Local' }, { displayName: 'Cloud', avatar: 'javascript:alert(1)' })).toEqual({});
});
