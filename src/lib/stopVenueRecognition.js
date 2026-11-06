import {metres} from './journeyGeometry.js';

// MapKit provides centre POI points, NOT verified property boundaries. Be
// conservative: a long recorded stop very close to a unique centre is required
// to promote a name automatically. More distant or competing centres remain
// suggestions in the explicit route-place search.
export const STOP_VENUE_MIN_SECONDS = 8 * 60;
export const STOP_VENUE_MAX_METRES = 90;
export const STOP_VENUE_COMPETING_METRES = 150;
// A centre's car park is often well over 90 m from its POI pin. Further away,
// only Apple's reverse geocode naming the stop's area of interest as that same
// centre is accepted; the POI distance alone never is.
export const STOP_VENUE_AREA_METRES = 250;
// Stop records looked up before areas of interest and a region-bound centre
// search are re-queried once.
export const STOP_LOOKUP_VERSION = 2;

const words = s => ` ${s.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;

export function recognisedStopVenue(record, point, durationSeconds) {
 if (!record?.stopLookup || record.partial || !Number.isFinite(durationSeconds) ||
     durationSeconds < STOP_VENUE_MIN_SECONDS ||
     !Number.isFinite(point?.latitude) || !Number.isFinite(point?.longitude)) return null;
 const areas = new Set((Array.isArray(record.areasOfInterest) ? record.areasOfInterest : [])
  .filter(a => typeof a === 'string').map(a => a.trim().toLocaleLowerCase()));

 // Apple Maps can return the same shopping centre more than once under slightly
 // different POI identifiers. Collapse identical names before looking for a
 // competing venue, so duplicate records don't block a good match.
 const unique = new Map();
 for (const candidate of record.candidates || []) {
  if (candidate?.category !== 'shoppingCentre' ||
      typeof candidate.name !== 'string' || !candidate.name.trim() ||
      !Number.isFinite(candidate.latitude) || !Number.isFinite(candidate.longitude)) continue;
  const distance = metres(point, candidate);
  if (!Number.isFinite(distance) || distance > STOP_VENUE_AREA_METRES) continue;
  const name = candidate.name.trim(), key = name.toLocaleLowerCase();
  const area = candidate.areaOfInterest === true && areas.has(key);
  const old = unique.get(key);
  if (!old || old.distance > distance) unique.set(key, {name, distance, placeID:candidate.placeID, area:area || !!old?.area});
  else if (area) old.area = true;
 }
 // A tenant named after its centre ("HomeCo. Warilla Grove") is part of that
 // centre, not a competing one, even when its pin is nearer the stop.
 const centres = [];
 for (const centre of [...unique.values()].sort((a,b) => a.name.length-b.name.length)) {
  const base = centres.find(c => words(centre.name).includes(words(c.name)));
  if (base) base.area ||= centre.area; else centres.push(centre);
 }
 centres.sort((a,b) => a.distance-b.distance);
 const contained = centres.filter(c => c.area);
 const chosen = contained.length === 1 ? contained[0] :
  !contained.length && centres[0]?.distance <= STOP_VENUE_MAX_METRES ? centres[0] : null;
 if (!chosen) return null;
 // Two different centres in the same vicinity are ambiguous even if the nearer
 // one is substantially closer. A POI coordinate alone cannot prove containment.
 if (centres.some(c => c !== chosen && c.distance <= STOP_VENUE_COMPETING_METRES)) return null;
 return {name:chosen.name, placeID:chosen.placeID,
   source:record.source || 'Apple Maps', distanceMeters:Math.round(chosen.distance),
   category:'shoppingCentre', basis:chosen.area ? 'areaOfInterest' : 'distance'};
}


// A possible centre is useful as a manual suggestion even if the evidence
 // isn't strong enough for an automatic tag. These are NOT confirmed visits.
export function suggestedStopVenues(record, point, durationSeconds) {
 if (!record || !Number.isFinite(durationSeconds) || durationSeconds < 180 ||
     !Number.isFinite(point?.latitude) || !Number.isFinite(point?.longitude)) return [];
 const seen=new Set();
 const nearby=(record.candidates || []).filter(candidate=>
  candidate?.category==='shoppingCentre'&&typeof candidate.name==='string'&&candidate.name.trim()&&
  Number.isFinite(candidate.latitude)&&Number.isFinite(candidate.longitude))
  .map(candidate=>({...candidate,distance:metres(point,candidate)}))
  .filter(candidate=>Number.isFinite(candidate.distance)&&candidate.distance<=STOP_VENUE_AREA_METRES);
 return nearby.sort((a,b)=>a.distance-b.distance)
  .filter(candidate=>{
   const name=candidate.name.trim().toLocaleLowerCase();
   // A tenant named after a centre in the same results is that centre.
   if(seen.has(name)||nearby.some(other=>other.name.trim().toLocaleLowerCase()!==name&&words(candidate.name).includes(words(other.name))))return false;
   seen.add(name);return true;
  })
  .map(candidate=>({name:candidate.name.trim(),source:record.source||'Apple Maps',kind:'stop'}));
}
