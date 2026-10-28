import { expect, it } from 'vitest';
import { canLinkTrail, routeBounds, trailCandidates, trailLinkLabel, trailLinkPayload, trailSummary } from './mtbLink.js';

const trail = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Fern Gully',
  geometry: [[-33.5, 151.1], [-33.51, 151.12]],
  distance_meters: 2400,
  direction: 'downhill',
  difficulty: 'black',
  access: 'sanctioned',
};

it('only offers a trail link on a finished manual mountain-bike recording', () => {
  const base = { activity: 'MTB', source: 'device', state: 'finished', recordingMode: 'manual' };
  expect(canLinkTrail(base)).toBe(true);
  expect(canLinkTrail({ ...base, activity: 'Mountain biking' })).toBe(true);
  expect(canLinkTrail({ ...base, source: 'watch' })).toBe(true);
  expect(canLinkTrail({ ...base, activity: 'Road cycling' })).toBe(false);
  expect(canLinkTrail({ ...base, state: 'recording' })).toBe(false);
  expect(canLinkTrail({ ...base, recordingMode: 'automatic' })).toBe(false);
  expect(canLinkTrail({ ...base, source: 'tesla' })).toBe(false);
  expect(canLinkTrail(null)).toBe(false);
});

it('pads a route box so trails just off the GPS trace are still found', () => {
  const box = routeBounds([[0, 0], [0.001, 0.001]], 750);
  expect(box.minLat).toBeLessThan(0);
  expect(box.maxLat).toBeGreaterThan(0.001);
  expect(box.minLon).toBeLessThan(0);
  expect(box.maxLon).toBeGreaterThan(0.001);
  expect(routeBounds([])).toBeNull();
});

it('normalises fetched trails, drops unusable geometry and orders by proximity', () => {
  const near = { ...trail, id: 'near', geometry: [[0, 0], [0, 0.001]] };
  const far = { ...trail, id: 'far', name: 'Far trail', geometry: [[1, 1], [1, 1.001]] };
  const broken = { ...trail, id: 'broken', geometry: [[0, 0]] };
  const candidates = trailCandidates([far, broken, near], [[0, 0], [0, 0.002]]);
  expect(candidates.map(c => c.id)).toEqual(['near', 'far']);
  expect(candidates[0]).toMatchObject({ name: 'Fern Gully', distanceMeters: 2400, direction: 'downhill', difficulty: 'Black', access: 'sanctioned' });
  expect(candidates[1].startDistanceMeters).toBeGreaterThan(candidates[0].startDistanceMeters);
});

it('builds exactly the native payload and clears the link with no trail', () => {
  expect(trailLinkPayload(trail)).toEqual({
    trailID: trail.id, trailName: 'Fern Gully', trailSegmentID: undefined, trailDistanceMeters: 2400,
  });
  expect(trailLinkPayload({ ...trail, name: 'x'.repeat(200) }).trailName).toHaveLength(120);
  expect(trailLinkPayload(null)).toEqual({});
});

it('reads a stored link from native details and from a mapped journey', () => {
  const fromDetails = trailSummary({ details: { mtbTrailID: trail.id, mtbTrailName: 'Fern Gully', mtbTrailDistanceMeters: 2400 } });
  expect(fromDetails).toEqual({ id: trail.id, name: 'Fern Gully', segmentID: null, distanceMeters: 2400 });
  expect(trailSummary({ trail: fromDetails })).toEqual(fromDetails);
  expect(trailSummary({ details: {} })).toBeNull();
  expect(trailSummary({})).toBeNull();
  expect(trailLinkLabel(fromDetails)).toBe('Fern Gully · 2.4 km');
  expect(trailLinkLabel(null)).toBe('');
});
