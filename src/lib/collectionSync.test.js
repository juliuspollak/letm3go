import { webcrypto } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { collectionBackupRow, collectionPhotoKey, mergeRestoredCollection, syncCollections } from './collectionSync.js';
const owner = '11111111-1111-4111-8111-111111111111';
const bike = '22222222-2222-4222-8222-222222222222';
const car = '33333333-3333-4333-8333-333333333333';
const photo = `data:image/jpeg;base64,${'A'.repeat(600)}`;
const item = extra => ({ id: bike, category: 'bicycle', name: 'Trek Checkpoint', make: 'Trek', model: 'Checkpoint', attributes: { year: '2024' }, source: 'manual', archived: false, ...extra });
function client({ upload = true } = {}) {
  return {
    rpc: vi.fn().mockResolvedValue({ data: 1, error: null }),
    functions: { invoke: vi.fn().mockResolvedValue(upload ? { data: { objectKey: `${owner}/collection/${bike}.jpg` }, error: null } : { data: null, error: { message: 'offline' } }) },
  };
}
const run = (api, vehicles, receipts = {}, opts = {}) => syncCollections(api, { owner, vehicles, receipts }, { cryptoImpl: webcrypto, ...opts });

it('shapes a row the database will accept and refuses an id it cannot own', () => {
  expect(collectionBackupRow(owner, { ...item(), id: 'not-a-uuid' })).toBeNull();
  expect(collectionBackupRow(owner, { ...item(), name: '', attributes: { Year: '2024', size: 'x'.repeat(130), colour: 'Green' } }))
    .toMatchObject({ id: bike, owner_id: owner, category: 'bicycle', name: '', attributes: { colour: 'Green' } });
  expect(collectionBackupRow(owner, item()).photo_object_key).toBeUndefined();
});

it('uploads a photo first, then stores only its deterministic owner-scoped key', async () => {
  const api = client();
  const result = await run(api, [{ ...item(), photo }]);
  expect(api.functions.invoke).toHaveBeenCalledWith('journeys', { body: expect.objectContaining({ action: 'collectionPhoto', itemID: bike, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }) });
  expect(api.rpc).toHaveBeenCalledWith('backup_collection_item', expect.objectContaining({ p_owner: owner, p_expected_revision: null }));
  const payload = api.rpc.mock.calls[0][1].p_payload;
  expect(payload.photo_object_key).toBe(collectionPhotoKey(owner, bike));
  expect(payload.photo_sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(result.photosUploaded).toBe(1);
  expect(result.receipts[`collection-photo:${bike}`]).toMatchObject({ owner, uploaded: true });
});

it('never writes a photo key when the upload failed', async () => {
  const api = client({ upload: false });
  await expect(run(api, [{ ...item(), photo }])).rejects.toThrow('preserved');
  expect(api.rpc).not.toHaveBeenCalled();
});

it('is incremental: an unchanged item and its photo are not uploaded again', async () => {
  const api = client();
  const first = await run(api, [{ ...item(), photo }]);
  api.rpc.mockClear(); api.functions.invoke.mockClear();
  const second = await run(api, [{ ...item(), photo }], first.receipts);
  expect(api.rpc).not.toHaveBeenCalled(); expect(api.functions.invoke).not.toHaveBeenCalled();
  expect(second.uploaded).toBe(0); expect(second.photosUploaded).toBe(0);
});

it('propagates an explicit removal but never deletes a local item', async () => {
  const api = client();
  const receipts = { [`collection:${bike}`]: { owner, deleted: true } };
  const result = await run(api, [], receipts);
  expect(api.rpc).toHaveBeenCalledWith('delete_collection_item', { p_owner: owner, p_id: bike });
  expect(result.deleted).toBe(1);
  api.rpc.mockClear();
  await run(api, [item()], receipts);
  expect(api.rpc).not.toHaveBeenCalledWith('delete_collection_item', expect.anything());
});

it('rejects receipts from another account before touching the cloud', async () => {
  const api = client();
  await expect(run(api, [item()], { [`collection:${bike}`]: { owner: car, fingerprint: 'a'.repeat(64) } })).rejects.toThrow('another account');
  expect(api.rpc).not.toHaveBeenCalled();
});

it('merges a restore without replacing a local item or duplicating a Tesla car', () => {
  const local = [item({ id: car, teslaVehicleID: '123', source: 'tesla', name: 'My Tesla' })];
  const cloud = [
    { id: bike, category: 'bicycle', name: 'Trek', make: 'Trek', model: '', attributes: {}, source: 'manual', archived: false },
    { id: car, category: 'car', name: 'Tesla', tesla_vehicle_id: '123', source: 'tesla' },
    { id: '44444444-4444-4444-8444-444444444444', category: 'other', name: '', make: 'Duotone', model: '', attributes: {}, source: 'manual' },
  ];
  const merged = mergeRestoredCollection(local, cloud);
  expect(merged.restored).toBe(2);
  expect(merged.vehicles).toHaveLength(3);
  expect(merged.vehicles[0].name).toBe('My Tesla');
  expect(merged.vehicles[2].name).toBe('Duotone');
  expect(mergeRestoredCollection(new Array(50).fill(item()), cloud).restored).toBe(0);
});
