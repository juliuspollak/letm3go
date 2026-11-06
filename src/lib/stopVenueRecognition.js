import {metres} from './journeyGeometry.js';

// MapKit provides centre POI points, NOT verified property boundaries. Be
// conservative: a long recorded stop very close to a unique centre is required
// to promote a name automatically. More distant or competing centres remain
// suggestions in the explicit route-place search.
export const STOP_VENUE_MIN_SECONDS = 8 * 60;
export const STOP_VENUE_MAX_METRES = 90;
export const STOP_VENUE_COMPETING_METRES = 150;

export function recognisedStopVenue(record, point, durationSeconds) {
 if (!record?.stopLookup || record.partial || !Number.isFinite(durationSeconds) ||
     durationSeconds < STOP_VENUE_MIN_SECONDS ||
     !Number.isFinite(point?.latitude) || !Number.isFinite(point?.longitude)) return null;

 // Apple Maps can return the same shopping centre more than once under slightly
 // different POI identifiers. Collapse identical names before looking for a
 // competing venue, so duplicate records don't block a good match.
 const unique = new Map();
 for (const candidate of record.candidates || []) {
  if (candidate?.category !== 'shoppingCentre' ||
      typeof candidate.name !== 'string' || !candidate.name.trim() ||
      !Number.isFinite(candidate.latitude) || !Number.isFinite(candidate.longitude)) continue;
  const distance = metres(point, candidate);
  if (!Number.isFinite(distance) || distance > STOP_VENUE_COMPETING_METRES) continue;
  const key = candidate.name.trim().toLocaleLowerCase();
  if (!unique.has(key) || unique.get(key).distance > distance)
   unique.set(key, {name:candidate.name.trim(), distance, placeID:candidate.placeID});
 }
 const centres = [...unique.values()].sort((a,b) => a.distance-b.distance);
 if (!centres.length || centres[0].distance > STOP_VENUE_MAX_METRES) return null;
 // Two different centres in the same vicinity are ambiguous even if the nearer
 // one is substantially closer. A POI coordinate alone cannot prove containment.
 if (centres.length > 1) return null;
 return {name:centres[0].name, placeID:centres[0].placeID,
   source:record.source || 'Apple Maps', distanceMeters:Math.round(centres[0].distance),
   category:'shoppingCentre'};
}
