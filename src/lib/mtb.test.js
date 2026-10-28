import { describe, expect, it } from 'vitest';
import {
  MTB_LAYERS, accessRestricted, bboxFromViewport, bboxOverlaps, canPublish,
  confidenceLabel, geometryDistance, geometryElevation, geometrySourceLabel,
  mtbOverlaysToMapPayload, simplifyGeometry, toggleMtbLayer, validGeometry,
} from './mtb.js';

describe('geometry', () => {
  it('accepts only valid [lat, lon] polylines of at least two points', () => {
    expect(validGeometry([[-33, 151], [-33.01, 151.02]])).toBe(true);
    expect(validGeometry([[-33, 151]])).toBe(false); // a point is not a path
    expect(validGeometry([])).toBe(false);
    expect(validGeometry([[95, 151], [-33, 151]])).toBe(false); // lat out of range
    expect(validGeometry([[-33, 200], [-33, 151]])).toBe(false); // lon out of range
    expect(validGeometry([[-33, 151], ['x', 'y']])).toBe(false); // non-numeric
    expect(validGeometry('nope')).toBe(false);
  });

  it('measures polyline distance with haversine', () => {
    // ~0.001 deg latitude apart ≈ 111 m.
    const d = geometryDistance([[-33, 151], [-33.001, 151]]);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(123);
  });

  it('reports elevation gain/loss only when samples exist', () => {
    expect(geometryElevation([[-33, 151], [-33.01, 151]])).toBeNull();
    const e = geometryElevation([[-33, 151, 100], [-33.01, 151, 120], [-33.02, 151, 115]]);
    expect(e).toEqual({ gain: 20, loss: 5 });
  });

  it('simplifies for display while keeping endpoints', () => {
    const line = [[-33, 151], [-33.001, 151], [-33.002, 151], [-33.003, 151]];
    const out = simplifyGeometry(line, 500);
    expect(out[0]).toEqual(line[0]);
    expect(out.at(-1)).toEqual(line.at(-1));
    expect(out.length).toBeLessThan(line.length);
    // A tight zigzag that stays within tolerance keeps its detail.
    const zig = [[-33, 151], [-33.00005, 151], [-33.0001, 151], [-33.00015, 151]];
    expect(simplifyGeometry(zig, 500).length).toBe(2);
  });
});

describe('layers', () => {
  it('toggles trails and segments independently', () => {
    expect(toggleMtbLayer([], 'trails')).toEqual(['trails']);
    expect(toggleMtbLayer(['trails'], 'segments')).toEqual(['trails', 'segments']);
    expect(toggleMtbLayer(['trails', 'segments'], 'trails')).toEqual(['segments']);
    expect(toggleMtbLayer([], 'unknown')).toEqual([]);
    expect(MTB_LAYERS).toEqual(['trails', 'segments']);
  });
});

describe('bounding boxes', () => {
  it('detects overlap for nearby lookups', () => {
    const view = bboxFromViewport({ lat: -33, lon: 151 }, 0.2, 0.2);
    expect(bboxOverlaps(view, { minLat: -33.05, maxLat: -33.04, minLon: 150.95, maxLon: 150.96 })).toBe(true);
    expect(bboxOverlaps(view, { minLat: -34, maxLat: -33.9, minLon: 150, maxLon: 150.1 })).toBe(false);
  });
});

describe('access and provenance', () => {
  it('keeps authored vs recorded vs verified geometry distinct', () => {
    expect(geometrySourceLabel('manual')).toBe('authored');
    expect(geometrySourceLabel('gps')).toBe('recorded');
    expect(geometrySourceLabel('verified')).toBe('verified');
    expect(confidenceLabel('gps')).toContain('recorded');
  });

  it('never publicly promotes closed or sensitive trails', () => {
    expect(accessRestricted('sanctioned')).toBe(false);
    expect(accessRestricted('unsanctioned')).toBe(false);
    expect(accessRestricted('restricted')).toBe(true);
    expect(accessRestricted('closed_permanent')).toBe(true);
    expect(accessRestricted('sensitive')).toBe(true);
    expect(canPublish('sanctioned', 'public')).toBe(true);
    expect(canPublish('closed_temporary', 'public')).toBe(false);
    expect(canPublish('sanctioned', 'private')).toBe(false);
  });
});

describe('map payload', () => {
  it('renders trails as routes and segments with start/finish markers', () => {
    const out = mtbOverlaysToMapPayload(
      [{ name: 'Ridge', geometry: [[-33, 151], [-33.01, 151]] }],
      [{ name: 'Downhill', geometry: [[-33, 151], [-33.02, 151]] }],
      ['trails', 'segments'],
    );
    expect(out.routes).toHaveLength(2);
    expect(out.pins).toHaveLength(2);
    expect(out.pins[0]).toMatchObject({ kind: 'start', point: [-33, 151] });
    expect(out.pins[1]).toMatchObject({ kind: 'finish', point: [-33.02, 151] });
  });
  it('omits a layer that is toggled off and skips degenerate geometry', () => {
    const out = mtbOverlaysToMapPayload(
      [{ name: 'Ridge', geometry: [[-33, 151], [-33.01, 151]] }],
      [{ name: 'Degenerate', geometry: [[-33, 151]] }],
      ['trails'],
    );
    expect(out.routes).toHaveLength(1);
    expect(out.pins).toHaveLength(0);
  });
});
