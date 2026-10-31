import {activityCode} from './activityNames.js';
import { distanceMeters, geometryDistance, validGeometry } from './mtb.js';

// Linking a recorded ride to a community trail is a private, local annotation.
// The link lives on the activity record (native `details`), never on the trail,
// so it works offline and cannot publish a rider's GPS line to the community.

// Only mountain-bike recordings can carry a trail link. Native storage refuses
// automatic journeys, because those are inferred rather than ridden. Apple Watch
// rides are included: they are real recordings and can be linked after transfer.
export const TRAIL_ACTIVITIES = ['MTB', 'Mountain biking'];
export const TRAIL_SOURCES = ['device', 'simulator', 'watch'];

export function isTrailActivity(trip){
  return !!trip && TRAIL_ACTIVITIES.includes(activityCode(trip.activity));
}

// Native refuses trail links for automatic journeys and unfinished recordings.
// Mirror that rule in the UI so a button is never offered where the write would
// be rejected.
export function canLinkTrail(trip){
  return isTrailActivity(trip)
    && TRAIL_SOURCES.includes(trip.source)
    && trip.state === 'finished'
    && trip.recordingMode !== 'automatic';
}

const coordinate = p => Array.isArray(p) ? p : [p?.latitude, p?.longitude];
const finitePoint = p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])
  && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;

// A padded box around the recorded route. Trails that start or finish a short
// walk from the GPS trace still appear, without querying the whole country.
export function routeBounds(route, paddingMeters = 750){
  const points = (Array.isArray(route) ? route : []).map(coordinate).filter(finitePoint);
  if(!points.length) return null;
  const latPad = Math.max(0, paddingMeters) / 111320;
  const lonPad = latPad / Math.max(0.01, Math.cos(points[0][0] * Math.PI / 180));
  const lats = points.map(p => p[0]), lons = points.map(p => p[1]);
  return {
    minLat: Math.min(...lats) - latPad, maxLat: Math.max(...lats) + latPad,
    minLon: Math.min(...lons) - lonPad, maxLon: Math.max(...lons) + lonPad,
  };
}

const label = value => String(value || '').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());

// Normalises fetched trails into linkable candidates, dropping records that
// cannot be resolved to a real path. Trails are ordered by how close they start
// to the ride, then by name, so the most likely link is first.
export function trailCandidates(trails = [], route = []){
  const origin = (Array.isArray(route) ? route : []).map(coordinate).find(finitePoint) || null;
  return (Array.isArray(trails) ? trails : [])
    .filter(t => t && t.id && validGeometry(t.geometry))
    .map(t => {
      const start = t.geometry[0];
      return {
        id: String(t.id),
        name: String(t.name || 'Unnamed trail').slice(0, 120),
        distanceMeters: Number.isFinite(t.distance_meters) ? t.distance_meters : geometryDistance(t.geometry),
        direction: t.direction || 'both',
        difficulty: label(t.difficulty || 'unknown'),
        access: t.access || 'unknown',
        start,
        startDistanceMeters: origin ? distanceMeters(origin, start) : null,
      };
    })
    .sort((a, b) => (a.startDistanceMeters ?? Infinity) - (b.startDistanceMeters ?? Infinity) || a.name.localeCompare(b.name));
}

// Exactly the arguments the native recorder stores. `undefined` values are
// omitted by the bridge, which clears the link when only `{ id }` is sent.
export function trailLinkPayload(trail){
  if(!trail || !trail.id) return {};
  return {
    trailID: String(trail.id),
    trailName: trail.name ? String(trail.name).slice(0, 120) : undefined,
    trailSegmentID: trail.segmentID ? String(trail.segmentID) : undefined,
    trailDistanceMeters: Number.isFinite(trail.distanceMeters) ? trail.distanceMeters
      : Number.isFinite(trail.distance_meters) ? trail.distance_meters : undefined,
  };
}

// Reads the stored link from a raw native activity's `details`, or from a
// `recordedJourney` value that has already been mapped.
export function trailSummary(trip){
  const details = trip?.details || {};
  const id = trip?.trail?.id ?? details.mtbTrailID;
  if(!id) return null;
  const name = trip?.trail?.name ?? details.mtbTrailName;
  const segmentID = trip?.trail?.segmentID ?? details.mtbSegmentID;
  const meters = trip?.trail?.distanceMeters ?? details.mtbTrailDistanceMeters;
  return {
    id: String(id),
    name: name ? String(name) : 'Linked trail',
    segmentID: segmentID ? String(segmentID) : null,
    distanceMeters: Number.isFinite(meters) ? meters : null,
  };
}

export function trailLinkLabel(trail){
  if(!trail) return '';
  return trail.distanceMeters ? `${trail.name} · ${(trail.distanceMeters / 1000).toFixed(1)} km` : trail.name;
}
