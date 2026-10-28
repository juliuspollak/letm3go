import { geometryDistance, geometryElevation } from './mtb.js';

// Build a segment draft from a slice of a recorded activity's route. The original
// activity is never modified; the slice becomes a new geometry with provenance
// 'gps' so it is identifiable as recorded (not authored) geometry.
export function sliceActivityRoute(points, startIndex, endIndex) {
  if (!Array.isArray(points) || startIndex < 0 || endIndex >= points.length || startIndex >= endIndex - 1) return null;
  const slice = points.slice(startIndex, endIndex + 1);
  const geometry = slice.map(p => {
    const lat = p.latitude ?? p[0];
    const lon = p.longitude ?? p[1];
    return Number.isFinite(p.altitude) ? [lat, lon, p.altitude] : [lat, lon];
  });
  return {
    geometry,
    distanceMeters: geometryDistance(geometry),
    elevation: geometryElevation(geometry),
    startIndex, endIndex,
  };
}

// Flags poor-quality source recordings rather than silently correcting them.
// Returns a list of human-readable warnings plus a usable flag.
export function routeQualityFlags(points) {
  const warnings = [];
  let maxGap = 0, coarse = 0;
  for (let i = 1; i < points.length; i++) {
    const dt = points[i].timestamp - points[i - 1].timestamp;
    if (Number.isFinite(dt) && dt > 0) maxGap = Math.max(maxGap, dt);
    if (Number.isFinite(points[i].accuracy) && points[i].accuracy > 30) coarse++;
  }
  if (maxGap > 120) warnings.push('Contains GPS gaps longer than two minutes.');
  if (coarse > points.length / 2) warnings.push('Most fixes are low precision.');
  return { warnings, usable: maxGap <= 120 && coarse <= points.length / 2 };
}
