import { geometryDistance, validGeometry } from './mtb.js';

// GPX import. Track geometry needs no timestamps; timed attempts still require the
// original recorded activity. Only <trk>/<trkseg>/<trkpt> are read.
export function parseGpx(xml) {
  if (typeof DOMParser === 'undefined') throw new Error('GPX parsing is unavailable here.');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid GPX file.');
  const tracks = [...doc.querySelectorAll('trk')];
  const name = tracks[0]?.querySelector('name')?.textContent?.trim() || '';
  const points = [];
  for (const trk of tracks) {
    for (const seg of trk.querySelectorAll('trkseg')) {
      for (const pt of seg.querySelectorAll('trkpt')) {
        const lat = Number(pt.getAttribute('lat'));
        const lon = Number(pt.getAttribute('lon'));
        const ele = Number(pt.querySelector('ele')?.textContent);
        points.push(Number.isFinite(ele) ? [lat, lon, ele] : [lat, lon]);
      }
    }
  }
  return { name, points };
}

// Validates imported geometry: coordinates, minimum length, duplicates and
// unreasonable jumps. Does not require timestamps.
export function validateGpx(points) {
  if (!validGeometry(points)) return { ok: false, reason: 'At least two valid track points are required.' };
  const seen = new Set();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const key = `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
    if (seen.has(key)) return { ok: false, reason: 'Duplicate location in track.' };
    seen.add(key);
    if (i > 0) {
      const d = geometryDistance([points[i - 1], p]);
      if (d > 50000) return { ok: false, reason: 'Unreasonable jump between track points.' };
    }
  }
  return { ok: true, reason: '' };
}
