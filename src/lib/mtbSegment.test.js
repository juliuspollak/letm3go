import { describe, expect, it } from 'vitest';
import { routeQualityFlags, sliceActivityRoute } from './mtbSegment.js';

describe('sliceActivityRoute', () => {
  const points = [
    { latitude: -33, longitude: 151, altitude: 100, timestamp: 0, accuracy: 5 },
    { latitude: -33.001, longitude: 151, altitude: 120, timestamp: 10, accuracy: 6 },
    { latitude: -33.002, longitude: 151, altitude: 130, timestamp: 20, accuracy: 7 },
    { latitude: -33.003, longitude: 151, altitude: 110, timestamp: 30, accuracy: 8 },
  ];
  it('slices a portion into [lat, lon, ele] geometry with distance and elevation', () => {
    const s = sliceActivityRoute(points, 0, 2);
    expect(s.geometry).toHaveLength(3);
    expect(s.geometry[0]).toEqual([-33, 151, 100]);
    expect(s.distanceMeters).toBeGreaterThan(200);
    expect(s.elevation).toEqual({ gain: 30, loss: 0 });
  });
  it('rejects invalid slices', () => {
    expect(sliceActivityRoute(points, 2, 1)).toBeNull();
    expect(sliceActivityRoute(points, 0, points.length)).toBeNull();
  });
});

describe('routeQualityFlags', () => {
  it('flags gaps and coarse fixes rather than silently correcting them', () => {
    const poor = [{ timestamp: 0, accuracy: 5 }, { timestamp: 200, accuracy: 60 }, { timestamp: 210, accuracy: 60 }];
    const f = routeQualityFlags(poor);
    expect(f.usable).toBe(false);
    expect(f.warnings.length).toBeGreaterThan(0);
    const good = [{ timestamp: 0, accuracy: 5 }, { timestamp: 10, accuracy: 6 }, { timestamp: 20, accuracy: 7 }];
    expect(routeQualityFlags(good).usable).toBe(true);
    expect(routeQualityFlags(good).warnings).toHaveLength(0);
  });
});
