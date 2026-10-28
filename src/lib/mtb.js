// MTB trail/segment model shared by the map, the editor and (later) the matcher.
// Geometry is a JSON array of [lat, lon] pairs, optionally [lat, lon, elevation].

export const MTB_ACCESS = ['sanctioned','unsanctioned','restricted','closed_temporary','closed_permanent','sensitive','unknown'];
export const MTB_ACCESS_LABELS = {
  sanctioned:'Sanctioned / open',
  unsanctioned:'Unsanctioned — access not established',
  restricted:'Restricted access',
  closed_temporary:'Temporarily closed',
  closed_permanent:'Permanently closed',
  sensitive:'Sensitive / hidden',
  unknown:'Unknown access',
};
export const MTB_STATUS = ['draft','submitted','under_review','changes_requested','approved','rejected','retired','hidden'];
export const MTB_STATUS_LABELS = {
  draft:'Draft', submitted:'Submitted', under_review:'Under review',
  changes_requested:'Changes requested', approved:'Approved', rejected:'Rejected',
  retired:'Retired', hidden:'Hidden',
};
export const MTB_DIRECTION = ['uphill','downhill','both'];
export const MTB_DIFFICULTY = ['green','blue','black','double_black','unknown'];
export const MTB_CONFIDENCE = ['manual','gps','verified'];
export const MTB_LAYERS = ['trails','segments'];

const validPoint = p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;

// A physical trail path must be at least two coordinates, never a single point.
export function validGeometry(points){
  return Array.isArray(points) && points.length >= 2 && points.length <= 50000 && points.every(validPoint);
}

function haversine(a, b){
  const r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r;
  const dLon = (b[1] - a[1]) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
}

export function geometryDistance(points){
  let total = 0;
  for(let i = 1; i < points.length; i++) total += haversine(points[i - 1], points[i]);
  return total;
}

// Elevation gain/loss in metres from consecutive deltas. Returns null when the
// geometry carries no elevation samples, so "0 m" is never presented as fact.
export function geometryElevation(points){
  let gain = 0, loss = 0, sampled = false;
  for(let i = 1; i < points.length; i++){
    const a = points[i - 1][2], b = points[i][2];
    if(Number.isFinite(a) && Number.isFinite(b)){
      sampled = true;
      const d = b - a;
      if(d > 0) gain += d; else if(d < 0) loss += -d;
    }
  }
  return sampled ? { gain, loss } : null;
}

// Douglas-Peucker display simplification. Endpoints are always retained; the
// tolerance is approximate metres so a corridor of detail is preserved, not a
// straight line between widely separated vertices.
function planarMeters(a, b){
  const lat = (a[0] + b[0]) / 2;
  const mLat = 111320, mLon = 111320 * Math.cos(lat * Math.PI / 180);
  return Math.hypot((b[0] - a[0]) * mLat, (b[1] - a[1]) * mLon);
}
function pointSegmentDistance(p, a, b){
  const x1 = a[1], y1 = a[0], x2 = b[1], y2 = b[0], x = p[1], y = p[0];
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if(len2 === 0) return planarMeters(p, a);
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
  return planarMeters(p, [y1 + t * dy, x1 + t * dx]);
}
export function simplifyGeometry(points, toleranceMeters){
  if(!Array.isArray(points) || points.length <= 2) return points;
  const tol = Math.max(0, toleranceMeters);
  if(tol <= 0) return points;
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while(stack.length){
    const [s, e] = stack.pop();
    let maxDist = -1, index = -1;
    for(let i = s + 1; i < e; i++){
      const d = pointSegmentDistance(points[i], points[s], points[e]);
      if(d > maxDist){ maxDist = d; index = i; }
    }
    if(index !== -1 && maxDist > tol){
      keep[index] = true;
      stack.push([s, index], [index, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

// Independent layer toggles for the MTB map.
export function toggleMtbLayer(layers, id){
  if(!MTB_LAYERS.includes(id)) return layers;
  return layers.includes(id) ? layers.filter(v => v !== id) : [...layers, id];
}

// Bounding-box helpers for nearby lookups.
export function bboxOverlaps(a, b){
  return a.minLat <= b.maxLat && a.maxLat >= b.minLat && a.minLon <= b.maxLon && a.maxLon >= b.minLon;
}
export function bboxFromViewport(center, latSpan, lonSpan){
  const halfLat = Math.abs(latSpan) / 2, halfLon = Math.abs(lonSpan) / 2;
  return {
    minLat: center.lat - halfLat, maxLat: center.lat + halfLat,
    minLon: center.lon - halfLon, maxLon: center.lon + halfLon,
  };
}

// Geometry provenance must stay visible: authored (hand-drawn) vs recorded (GPS)
// vs verified (moderator-confirmed). None of these is "proof a trail exists".
export const confidenceLabel = c => ({ manual:'Drawn by hand', gps:'From a recorded ride', verified:'Verified geometry' }[c]) || c;
export const geometrySourceLabel = c => c === 'verified' ? 'verified' : c === 'gps' ? 'recorded' : 'authored';

// A closed/restricted trail must not be publicly promoted even when its geometry
// is accurate.
export const accessRestricted = access => ['restricted','closed_temporary','closed_permanent','sensitive'].includes(access);
export const canPublish = (access, visibility) => visibility === 'public' && !accessRestricted(access);

// Maps fetched trails/segments to the existing map payload shape ({routes, pins})
// so the MTB map can reuse the current Apple Maps renderer with no native change.
// Trails render as plain routes; segments add start/finish markers.
export function mtbOverlaysToMapPayload(trails = [], segments = [], layers = []) {
  const routes = [], pins = [];
  if (layers.includes('trails')) {
    for (const t of trails) if (Array.isArray(t.geometry) && t.geometry.length >= 2) routes.push(t.geometry);
  }
  if (layers.includes('segments')) {
    for (const s of segments) {
      if (!Array.isArray(s.geometry) || s.geometry.length < 2) continue;
      routes.push(s.geometry);
      pins.push({ point: s.geometry[0], title: `${s.name} start`, kind: 'start' });
      pins.push({ point: s.geometry[s.geometry.length - 1], title: `${s.name} finish`, kind: 'finish' });
    }
  }
  return { routes, pins };
}
