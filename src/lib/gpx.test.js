import { describe, expect, it } from 'vitest';
import { parseGpx, validateGpx } from './gpx.js';

describe('parseGpx', () => {
  it('extracts track points and name without requiring timestamps', () => {
    const xml = `<gpx><trk><name>Ridge</name><trkseg><trkpt lat="-33" lon="151"><ele>100</ele></trkpt><trkpt lat="-33.001" lon="151.001"><ele>120</ele></trkpt></trkseg></trk></gpx>`;
    const { name, points } = parseGpx(xml);
    expect(name).toBe('Ridge');
    expect(points).toEqual([[-33, 151, 100], [-33.001, 151.001, 120]]);
  });
  it('omits elevation when absent and throws on invalid XML', () => {
    const xml = `<gpx><trk><trkseg><trkpt lat="-33" lon="151"/></trkseg></trk></gpx>`;
    expect(parseGpx(xml).points).toEqual([[-33, 151]]);
    expect(() => parseGpx('not xml <')).toThrow();
  });
});

describe('validateGpx', () => {
  it('accepts valid geometry and rejects bad input', () => {
    expect(validateGpx([[-33, 151], [-33.001, 151]])).toEqual({ ok: true, reason: '' });
    expect(validateGpx([[-33, 151]]).ok).toBe(false);
    expect(validateGpx([[95, 151], [-33, 151]]).ok).toBe(false);
    expect(validateGpx([[-33, 151], [-33, 151]]).reason).toContain('Duplicate');
    expect(validateGpx([[-33, 151], [-34, 153]]).reason).toContain('jump');
  });
});
