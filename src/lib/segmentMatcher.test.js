// FILE: src/lib/segmentMatcher.test.js
import {describe, expect, it} from 'vitest';
import {SEGMENT_MATCHER_VERSION, SEGMENT_MATCH_SETTINGS, effortStats, matchEfforts, routePasses, samePassRange, segmentDefinition} from './segmentMatcher.js';

// Deterministic PRNG (mulberry32): no Math.random anywhere in the fixtures.
function prng(seed) {
 let s = seed >>> 0;
 return () => {
  s = (s + 0x6D2B79F5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
 };
}

const ORIGIN_LAT = -34.4;
const ORIGIN_LON = 150.9;
const TRAIL_METRES = 600;
const LAT_DEG_PER_M = 1 / 111320;
const LON_DEG_PER_M = 1 / (111320 * Math.cos(ORIGIN_LAT * Math.PI / 180));

const fix = (latitude, longitude, timestamp, accuracy = 5, segment = 0) => ({latitude, longitude, timestamp, accuracy, segment});
const trailFix = (alongEast, lateral, timestamp, accuracy = 5) => fix(ORIGIN_LAT + lateral * LAT_DEG_PER_M, ORIGIN_LON + alongEast * LON_DEG_PER_M, timestamp, accuracy);
const offTrail = (rng, timestamp) => fix(ORIGIN_LAT + (2000 + (rng() - 0.5) * 10) * LAT_DEG_PER_M, ORIGIN_LON + (rng() - 0.5) * 0.02, timestamp);
const lateralNoise = rng => (3 + rng() * 5) * (rng() < 0.5 ? -1 : 1);

// A clean (noise-free) 120 s, 600 m trail source for the definition.
const sourcePoints = [];
for (let t = 0; t <= 120; t++) sourcePoints.push(trailFix(TRAIL_METRES * t / 120, 0, t));
const definition = segmentDefinition({id: 'seg1', ownerID: 'me', name: 'Test trail', trip: {id: 'src', points: sourcePoints}, start: 0, end: sourcePoints.length - 1, createdAt: 1700000000});

function longRide(rng, laps) {
 const points = new Array(7200);
 for (let t = 0; t < 7200; t++) {
  const lap = laps.find(l => t >= l.t0 && t <= l.t0 + l.duration);
  points[t] = lap
   ? trailFix(TRAIL_METRES * (t - lap.t0) / lap.duration, lateralNoise(rng), t)
   : offTrail(rng, t);
 }
 return points;
}

describe('segment matcher settings', () => {
 it('exposes a version and frozen tolerances', () => {
  expect(SEGMENT_MATCHER_VERSION).toBe(1);
  expect(Object.isFrozen(SEGMENT_MATCH_SETTINGS)).toBe(true);
 });
});

describe('repeated laps', () => {
 const laps = [{t0: 1000, duration: 120}, {t0: 3000, duration: 118}, {t0: 5000, duration: 122}];
 const points = longRide(prng(1), laps);
 const result = matchEfforts(definition, {id: 'ride', points});
 const tap = {latitude: ORIGIN_LAT, longitude: ORIGIN_LON + 300 * LON_DEG_PER_M};
 const passes = routePasses(points, tap);

 it('matches exactly three efforts, each elapsed within 1 s of the true lap', () => {
  expect(result.efforts).toHaveLength(3);
  expect(result.efforts.map(e => e.confidence)).toEqual(['high', 'high', 'high']);
  const expected = [120, 118, 122];
  result.efforts.forEach((e, i) => {
   expect(Math.abs(e.elapsedSeconds - expected[i])).toBeLessThanOrEqual(1);
   expect(e.startIndex).toBeGreaterThanOrEqual(laps[i].t0);
   expect(e.coverage).toBeGreaterThanOrEqual(SEGMENT_MATCH_SETTINGS.checkpointCoverage);
  });
 });

 it('summarises best, average and last', () => {
  const stats = effortStats(result.efforts);
  expect(stats.count).toBe(3);
  expect(Math.abs(stats.best - 118)).toBeLessThanOrEqual(1);
  expect(Math.abs(stats.average - 120)).toBeLessThanOrEqual(1);
  expect(Math.abs(stats.last - 122)).toBeLessThanOrEqual(1);
 });

 it('finds three passes at a mid-trail tap and rejects a two-lap span', () => {
  expect(passes).toHaveLength(3);
  expect(passes.map(p => p.passNumber)).toEqual([1, 2, 3]);
  passes.forEach(p => expect(p.distanceMeters).toBeLessThanOrEqual(SEGMENT_MATCH_SETTINGS.passToleranceMeters));
  expect(samePassRange(points, passes[0], passes[0])).toEqual({start: passes[0].index, end: passes[0].index});
  expect(samePassRange(points, passes[0], passes[2])).toEqual({problem: 'multiple-laps'});
 });
});

describe('cut-short pass', () => {
 const laps = [{t0: 1000, duration: 120}, {t0: 3000, duration: 118}];
 const rng = prng(2);
 const points = new Array(7200);
 for (let t = 0; t < 7200; t++) {
  const lap = laps.find(l => t >= l.t0 && t <= l.t0 + l.duration);
  if (lap) points[t] = trailFix(TRAIL_METRES * (t - lap.t0) / lap.duration, lateralNoise(rng), t);
  else if (t >= 5000 && t <= 5060) points[t] = trailFix(300 * (t - 5000) / 60, lateralNoise(rng), t);
  else points[t] = offTrail(rng, t);
 }
 const result = matchEfforts(definition, {id: 'ride', points});
 it('yields two efforts and one partial reject', () => {
  expect(result.efforts).toHaveLength(2);
  expect(result.rejects).toHaveLength(1);
  expect(result.rejects[0].reason).toBe('partial');
 });
});

describe('reverse travel', () => {
 const rng = prng(3);
 const points = [];
 for (let t = 0; t <= 120; t++) points.push(trailFix(TRAIL_METRES * (1 - t / 120), lateralNoise(rng), t));
 for (let t = 121; t < 300; t++) points.push(offTrail(rng, t));
 it('is a reverse reject, never an effort', () => {
  const result = matchEfforts(definition, {id: 'ride', points});
  expect(result.efforts).toHaveLength(0);
  expect(result.rejects).toEqual([{reason: 'reverse', startTimestamp: 0}]);
 });
});

describe('parallel trail 40 m away', () => {
 const points = [];
 for (let t = 0; t <= 120; t++) points.push(trailFix(TRAIL_METRES * t / 120, 40 * Math.sin(Math.PI * t / 120), t));
 it('is off-route even though it shares the start and finish zones', () => {
  const result = matchEfforts(definition, {id: 'ride', points});
  expect(result.efforts).toHaveLength(0);
  expect(result.rejects).toHaveLength(1);
  expect(result.rejects[0].reason).toBe('off-route');
 });
});

describe('GPS gap inside a pass', () => {
 const points = [];
 for (let t = 0; t <= 60; t++) points.push(trailFix(5 * t, 0, t)); // along 0..300
 points.push(trailFix(400, 0, 481)); // 7 minutes later, 100 m ahead -> too long to be the same pass
 for (let k = 1; k <= 40; k++) points.push(trailFix(400 + 5 * k, 0, 481 + k)); // along 405..600
 it('is a gap reject', () => {
  const result = matchEfforts(definition, {id: 'ride', points});
  expect(result.efforts).toHaveLength(0);
  expect(result.rejects).toEqual([{reason: 'gap', startTimestamp: 0}]);
 });
});

describe('closed loop with identical start and finish', () => {
 const circleFix = (angleDeg, timestamp, noise) => {
  const a = angleDeg * Math.PI / 180;
  const north = 100 * Math.sin(a);
  const east = 100 * Math.cos(a);
  return fix(ORIGIN_LAT + (north + noise) * LAT_DEG_PER_M, ORIGIN_LON + east * LON_DEG_PER_M, timestamp);
 };
 const src = [];
 for (let t = 0; t <= 120; t++) src.push(circleFix(3 * t, t, 0));
 const loop = segmentDefinition({id: 'loop', ownerID: 'me', name: 'Loop', trip: {id: 'loopsrc', points: src}, start: 0, end: src.length - 1, createdAt: 1});
 const rng = prng(4);
 const ride = [];
 for (let t = 0; t <= 120; t++) ride.push(circleFix(3 * t, t, lateralNoise(rng)));
 it('does not produce a zero-length effort', () => {
  expect(loop.lengthMeters).toBeGreaterThan(0);
  const result = matchEfforts(loop, {id: 'loopride', points: ride});
  expect(result.efforts).toHaveLength(1);
  expect(result.efforts[0].elapsedSeconds).toBeGreaterThan(0);
 });
});

describe('self-crossing loop and out-and-back', () => {
 const lemniscateFix = (phi, timestamp, a, noise) => {
  const x = a * Math.cos(phi);
  const y = a * Math.sin(phi) * Math.cos(phi);
  return fix(ORIGIN_LAT + (y + noise) * LAT_DEG_PER_M, ORIGIN_LON + x * LON_DEG_PER_M, timestamp);
 };
 const rng = prng(5);
 const src = [];
 for (let t = 0; t <= 120; t++) src.push(lemniscateFix(2 * Math.PI * t / 120, t, 100, 0));
 const fig = segmentDefinition({id: 'fig', ownerID: 'me', name: 'Figure eight', trip: {id: 'figsrc', points: src}, start: 0, end: src.length - 1, createdAt: 1});
 const ride = [];
 for (let t = 0; t <= 120; t++) ride.push(lemniscateFix(2 * Math.PI * t / 120, t, 100, lateralNoise(rng)));

 it('matches a figure-eight once and sees two passes at its crossing', () => {
  const result = matchEfforts(fig, {id: 'figride', points: ride});
  expect(result.efforts).toHaveLength(1);
  expect(result.efforts[0].elapsedSeconds).toBeGreaterThan(0);
  expect(routePasses(ride, {latitude: ORIGIN_LAT, longitude: ORIGIN_LON})).toHaveLength(2);
 });

 it('keeps an effort when the rider turns back after the finish', () => {
  const ride = [];
  for (let t = 0; t <= 140; t++) ride.push(trailFix(Math.min(700, 5 * t), 0, t));
  for (let t = 141; t <= 280; t++) ride.push(trailFix(700 - 5 * (t - 140), 0, t));
  const result = matchEfforts(definition, {id: 'turn', points: ride});
  expect(result.efforts).toHaveLength(1);
  expect(result.efforts[0].elapsedSeconds).toBeGreaterThanOrEqual(119);
  expect(result.efforts[0].elapsedSeconds).toBeLessThanOrEqual(121);
 });

 it('counts every lap of continuous laps, not every other one', () => {
  const ride = [];
  const lap = t => { const place = t % 240; return place <= 120 ? 5 * place : 600 - 5 * (place - 120); };
  for (let t = 0; t < 720; t++) ride.push(trailFix(lap(t), 0, t));
  // There and back three times: the outbound passes are the three efforts.
  expect(matchEfforts(definition, {id: 'laps', points: ride}).efforts).toHaveLength(3);
 });

 it('does not count a parallel trail 40 m away', () => {
  const ride = [];
  for (let t = 0; t <= 120; t++) ride.push(trailFix(5 * t, 40, t, 15));
  expect(matchEfforts(definition, {id: 'parallel', points: ride}).efforts).toHaveLength(0);
 });

 it('counts a ride with ordinary GPS wander', () => {
  const rng = prng(9), ride = [];
  for (let t = 0; t <= 120; t++) ride.push(trailFix(5 * t, lateralNoise(rng), t));
  expect(matchEfforts(definition, {id: 'wander', points: ride}).efforts).toHaveLength(1);
 });

 it('finds passes recorded with sparse fixes', () => {
  for (const [step, seconds] of [[40, 5], [60, 6], [100, 10]]) {
   const ride = [];
   for (let east = -step * 2, t = 0; east <= 600 + step * 2; east += step, t += seconds) ride.push(trailFix(east + 7, 0, t));
   const {efforts} = matchEfforts(definition, {id: 'sparse', points: ride});
   expect(efforts).toHaveLength(1);
   expect(Math.abs(efforts[0].elapsedSeconds - 600 / step * seconds)).toBeLessThanOrEqual(seconds);
  }
 });

 it('rides through a brief GPS wander without losing the pass', () => {
  const ride = [];
  for (let t = 0; t <= 120; t++) ride.push(trailFix(5 * t, t >= 50 && t <= 58 ? 60 : 0, t));
  expect(matchEfforts(definition, {id: 'wander', points: ride}).efforts).toHaveLength(1);
 });

 it('does not count a ride that leaves the trail for good', () => {
  const ride = [];
  for (let t = 0; t <= 120; t++) ride.push(trailFix(5 * t, t >= 40 ? 80 : 0, t));
  expect(matchEfforts(definition, {id: 'left', points: ride}).efforts).toHaveLength(0);
 });

 it('builds a saved segment from a recording that repeats a timestamp', () => {
  const repeated = sourcePoints.map((p, i) => i === 40 ? {...p, timestamp: sourcePoints[39].timestamp} : p);
  const trip = {id: 'dup', points: repeated};
  expect(segmentDefinition({id: 'd', trip, start: 0, end: 120})).toBeNull();
  const saved = segmentDefinition({id: 'd', trip, start: 0, end: 120, saved: true});
  expect(matchEfforts(saved, trip).efforts).toHaveLength(1);
 });

 it('still rejects a real U-turn on a straight route', () => {
  const ride = [];
  for (let t = 0; t <= 60; t++) ride.push(trailFix(300 * t / 60, 0, t));
  for (let t = 61; t <= 120; t++) ride.push(trailFix(300 - 300 * (t - 60) / 60, 0, t));
  expect(matchEfforts(definition, {id: 'uturn', points: ride}).efforts).toHaveLength(0);
 });

 it('matches an out-and-back traversal once', () => {
  const outBackFix = (along, timestamp, noise) => {
   const east = along <= 300 ? along : 600 - along;
   return trailFix(east, noise, timestamp);
  };
  const rng2 = prng(6);
  const src2 = [];
  for (let t = 0; t <= 120; t++) src2.push(outBackFix(600 * t / 120, t, 0));
  const outBack = segmentDefinition({id: 'ob', ownerID: 'me', name: 'Out and back', trip: {id: 'obsrc', points: src2}, start: 0, end: src2.length - 1, createdAt: 1});
  const ride2 = [];
  for (let t = 0; t <= 120; t++) ride2.push(outBackFix(600 * t / 120, t, lateralNoise(rng2)));
  const result = matchEfforts(outBack, {id: 'obride', points: ride2});
  expect(result.efforts).toHaveLength(1);
  expect(result.efforts[0].elapsedSeconds).toBeGreaterThan(0);
 });
});

describe('low accuracy', () => {
 const rng = prng(7);
 const points = [];
 for (let t = 0; t <= 120; t++) points.push(trailFix(TRAIL_METRES * t / 120, (8 + rng() * 17) * (rng() < 0.5 ? -1 : 1), t, 40));
 it('is matched but not high confidence', () => {
  const result = matchEfforts(definition, {id: 'ride', points});
  expect(result.efforts).toHaveLength(1);
  expect(result.efforts[0].confidence).not.toBe('high');
 });
});

describe('determinism and non-mutation', () => {
 it('is idempotent and never mutates the input ride or source', () => {
  const points = longRide(prng(8), [{t0: 1000, duration: 120}, {t0: 3000, duration: 118}, {t0: 5000, duration: 122}]);
  const rideSnapshot = JSON.stringify(points);
  const a = matchEfforts(definition, {id: 'ride', points});
  const b = matchEfforts(definition, {id: 'ride', points});
  expect(a).toEqual(b);
  expect(JSON.stringify(points)).toBe(rideSnapshot);

  const src = [...sourcePoints];
  const srcSnapshot = JSON.stringify(src);
  segmentDefinition({id: 'x', ownerID: 'me', name: 'x', trip: {id: 'src', points: src}, start: 0, end: src.length - 1, createdAt: 1});
  expect(JSON.stringify(src)).toBe(srcSnapshot);
 });

 it('rejects an invalid or gapped definition slice', () => {
  expect(segmentDefinition({id: 'a', ownerID: 'me', name: 'a', trip: {id: 'src', points: sourcePoints}, start: 10, end: 5, createdAt: 1})).toBeNull();
  const gapped = [...sourcePoints];
  gapped[60] = {...gapped[60], timestamp: gapped[60].timestamp + 600, latitude: gapped[60].latitude + 0.001};
  expect(segmentDefinition({id: 'b', ownerID: 'me', name: 'b', trip: {id: 'src', points: gapped}, start: 0, end: gapped.length - 1, createdAt: 1})).toBeNull();
 });
});
