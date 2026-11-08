import {activityCode} from './activityNames.js';
import {metres} from './journeyGeometry.js';
import {personalPlace,savedPlaceRadius} from './rememberedPlace.js';

export const LOOKUP_VERSION=2;
const outdoor=new Set(['Walking','Hiking','Running','Cycling','MTB','Road cycling']);
const natural=new Set(['park','nationalPark','reserve','trail','lookout','landmark','savedPlace']);
const normalized=s=>String(s||'').trim().toLocaleLowerCase();
// One cut-off for a fix worth believing, shared by route evidence, dwell and the
// end-of-trip rule below, so no part of recognition disagrees about what a usable
// fix is.
const USABLE_ACCURACY=40;
// The saved place the activity ended at sits in its own score tier, above every
// inferred score (the highest a POI can reach is 134: 50 route + 25 dwell + 35
// verified trail + 24 national park), so a provider's guess never overtakes a name
// the person chose. Which saved place that is, is decided by distance alone.
const SAVED_TIER=1000;

export function recognitionSampleIndexes(trip,stops=[]){
 const points=trip.points||[];
 if(!points.length)return [];
 const count=Math.min(outdoor.has(activityCode(trip.activity))?10:3,points.length);
 return [...new Set([0,points.length-1,...stops.map(s=>s.pointIndex),...Array.from({length:count},(_,i)=>Math.round(i*(points.length-1)/Math.max(1,count-1)))])].filter(i=>points[i]);
}
// An activity is enriched once, when it is saved; its answers are final. "Nothing
// found" is an answer too. Nothing expires or is refreshed later. Only a failed or
// incomplete provider answer is retried, with backoff, a bounded number of times.
export const LOOKUP_ATTEMPTS=5;
const backoff=attempts=>5*60000*2**(attempts-1);
export function lookupDue(cached,now=Date.now()){
 if(!cached)return true;
 return Number.isFinite(cached.retryAfter)&&cached.retryAfter<=now;
}
export function cachedLookup(place,now=Date.now(),previous=null){
 const attempts=(previous?.attempts||0)+1;
 const {retryAfter:_drop,...answer}=place;void _drop;
 return {...answer,lookupVersion:LOOKUP_VERSION,lookedUpAt:now,attempts,
  ...(place.partial&&attempts<LOOKUP_ATTEMPTS?{retryAfter:now+backoff(attempts)}:{})};
}
// A lookup that failed outright keeps any earlier answer. After the last attempt
// the place is settled with what there is (possibly nothing).
export function failedLookup(previous,now=Date.now()){
 const attempts=(previous?.attempts||0)+1;
 const {retryAfter:_drop,...kept}=previous||{};void _drop;
 return attempts<LOOKUP_ATTEMPTS?{...kept,attempts,retryAfter:now+backoff(attempts)}:{candidates:[],...kept,attempts,lookedUpAt:now,unavailable:true};
}
// Where an activity ended, for one saved place. What counts is how the activity
// arrived at its end, not every fix the journey ever recorded inside the fence:
// - only the final unbroken run of fixes inside the fence is evidence of ending
//   there. A drive that passes the place, leaves and comes back starts counting
//   again on its return, so fixes from passing earlier never add up to an arrival;
// - a fix less accurate than USABLE_ACCURACY is neither inside nor outside. iOS
//   often hands back a drifting fix once a car has stopped, and a genuine
//   destination must not be lost to it, nor invented by it;
// - a usable fix ends the run only when it is outside the fence by more than its
//   own stated accuracy. One at the fence edge, which could be either, neither
//   breaks nor extends it, so parking at the edge of a place is not "leaving";
// - the run must hold at least two fixes: one inside fix can be a spike. A drive
//   records every 5 m and the smallest fence is 50 m across its radius, so a real
//   arrival leaves several; stopping in the place and losing GPS afterwards keeps
//   the run that was already recorded.
// A trip recorded entirely with poor fixes is judged on the fixes it has, by the
// same rule, so weak GPS still works where there is nothing better to use.
// `metres` is measured from the same final fix for every place, so overlapping
// places can be ranked by how near the activity's end they are (singleSavedEnd).
function savedEndEvidence(candidate,fixes,radius){
 const usable=fixes.filter(fix=>fix.usable),judged=usable.length?usable:fixes;
 let run=0;
 for(const {point} of judged){
  const away=metres(point,candidate);
  if(away<=radius)run+=1;
  else if(away-(Number.isFinite(point.accuracy)&&point.accuracy>0?point.accuracy:0)>radius)run=0;
 }
 if(run<2)return null;
 return {metres:metres(judged.at(-1).point,candidate)};
}
// Only one place can be where the activity ended. Among the saved places the trip
// ended inside, the one nearest the end wins on that distance alone (route, dwell
// or category evidence never decides it), with name and then ID breaking an exact
// tie. Every other one becomes a nearby place, so one trip is never tagged with
// two remembered names.
function singleSavedEnd(places,distance){
 const ended=places.filter(place=>place.evidence.savedEnd)
  .sort((a,b)=>distance.get(a)-distance.get(b)||a.name.localeCompare(b.name)||String(a.placeID||'').localeCompare(String(b.placeID||'')));
 const [winner,...others]=ended;
 for(const place of others){
  place.role='nearby';place.supported=false;place.score=0;
  place.evidence={...place.evidence,savedEnd:false,containment:false,supersededBy:winner.name};
  place.reason=`user-saved place near where the activity ended, not the end point (${winner.name})`;
 }
}
// A nearby pin is never containment. Promotion requires category plus substantial
// route evidence or measured dwell; POI search regions are never area boundaries.
export function assessRoutePlaces(trip,records=[],{hidden=[]}={}){
 const points=(trip.points||[]).filter(p=>Number.isFinite(p.accuracy)&&p.accuracy>=0&&p.accuracy<=USABLE_ACCURACY);
 // Every recorded fix, whatever its accuracy, for containment in a saved place:
 // the person's own statement about a location does not depend on the fix quality,
 // and savedEndEvidence decides how far each fix is trusted.
 const fixes=(trip.points||[]).filter(p=>p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude))
  .map(point=>({point,usable:Number.isFinite(point.accuracy)&&point.accuracy>=0&&point.accuracy<=USABLE_ACCURACY}));
 const excluded=new Set(hidden.map(normalized)),unique=new Map();
 for(const record of records)for(const found of record?.candidates||[]){
  const category=/\bcar\s?park(?:ing)?$/i.test(found?.name||'')?'parking':({'MKPOICategoryHiking':'trail','MKPOICategoryLandmark':'landmark'}[found?.category]||found?.category);
  const candidate={...found,providerCategory:found?.providerCategory||found?.category,category};
  if(!candidate?.name||excluded.has(normalized(candidate.name))||(!candidate.userSaved&&/^(park|reserve|trail|car park|parking|lookout|nature|outdoors)$/i.test(candidate.name.trim())))continue;
  const key=candidate.placeID||`${normalized(candidate.name)}:${candidate.latitude}:${candidate.longitude}`;
  if(!unique.has(key))unique.set(key,candidate);
 }
 // The exact end distance of each saved place the trip ended in, for singleSavedEnd.
 const distance=new Map();
 const assessed=[...unique.values()].map(candidate=>{
  const distances=points.map(p=>metres(p,candidate)),nearest=Math.min(...distances);
  const close=points.filter((_,i)=>distances[i]<=50);
  // Dwell needs continuous observed fixes; pauses/gaps cannot fabricate time.
  let dwellSeconds=0;
  for(let i=1;i<points.length;i++){
   const a=points[i-1],b=points[i],dt=b.timestamp-a.timestamp;
   if(dt>0&&dt<=45&&a.segment===b.segment&&distances[i-1]<=20&&distances[i]<=20&&metres(a,b)<=5)dwellSeconds+=dt;
  }
  const coverage=points.length?distances.filter(d=>d<=250).length/points.length:0;
  const extent=close.length?Math.max(...close.map(p=>metres(close[0],p))):0;
  const span=close.length>1?close.at(-1).timestamp-close[0].timestamp:0;
  const significant=natural.has(candidate.category);
  const routeSupported=outdoor.has(activityCode(trip.activity))&&significant&&nearest<=50&&coverage>=0.65&&extent>=75&&span>=300;
  const dwellSupported=dwellSeconds>=(candidate.category==='parking'?45:120);
  const savedRadius=candidate.userSaved?savedPlaceRadius(candidate):0;
  const savedCoverage=savedRadius&&points.length?distances.filter(d=>d<=savedRadius).length/points.length:0;
  // A drive to a shop never covers the shop's radius, so a saved place is
  // recognised where the activity ended instead. Home and Work are personal places,
  // not destinations, and keep the existing route-coverage rule so a drive home is
  // never titled as a destination.
  const savedEnd=savedRadius&&!personalPlace(candidate)?savedEndEvidence(candidate,fixes,savedRadius):null;
  const savedSupported=!!savedEnd||(savedCoverage>=.7&&points.length>=3&&points.at(-1).timestamp-points[0].timestamp>=300);
  const supported=routeSupported||dwellSupported||savedSupported;
  // The two ends of the activity, judged on the same fixes every other rule trusts,
  // so one drifting fix at the end cannot deny that this is where the trip stopped.
  const usableFixes=fixes.filter(fix=>fix.usable);
  const endpoint=[(usableFixes[0]||fixes[0])?.point,(usableFixes.at(-1)||fixes.at(-1))?.point].some(p=>p&&metres(p,candidate)<=40);
  const confidence=supported?Math.min(.97,.72+(savedEnd ? .2 : 0)+(routeSupported ? .12 : 0)+(dwellSupported ? .08 : 0)+(candidate.placeID ? .03 : 0)):.25;
  // Where the person saved the place the activity ended at, that place is the
  // destination even if its name reads like parking ("Bunnings car park"): they
  // chose it as the end of the trip, not as a car park they merely passed.
  const role=supported?(candidate.category==='parking'&&!savedEnd?'startFinish':savedEnd||significant?'destination':'visited'):'nearby';
  const savedScore=savedEnd?SAVED_TIER:0;
  const place={...candidate,role,supported,confidence,score:savedScore+(routeSupported?50:0)+(dwellSupported?25:0)+(candidate.verifiedTrail?35:0)+({nationalPark:24,reserve:22,park:18,trail:16,lookout:12,landmark:10}[candidate.category]||0),
   evidence:{nearestMeters:Number.isFinite(nearest)?Math.round(nearest):null,routeCoverage:coverage,dwellSeconds:Math.round(dwellSeconds),endpoint,routeSupported,savedEnd:!!savedEnd,savedEndMetres:savedEnd?Math.round(savedEnd.metres):null,containment:savedSupported?'user-saved geofence':false},
   reason:supported?(savedEnd?'user-saved place where the activity ended':savedSupported?'user-saved geofence and sustained observations':routeSupported?'category and sustained route coverage':'observed dwell'):'insufficient visit evidence'};
  if(savedEnd)distance.set(place,savedEnd.metres);
  return place;
 });
 singleSavedEnd(assessed,distance);
 assessed.sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name));
 const primary=assessed.find(c=>c.role==='destination')||null;
 return {primary,startFinish:assessed.filter(c=>c.role==='startFinish'),visited:assessed.filter(c=>c.supported).slice(0,6),nearby:assessed.filter(c=>!c.supported).slice(0,12),candidates:assessed};
}
export function destinationTitle(activity,destination){
 if(!destination)return null;
 const name=destination.name;
 if(destination.verifiedTrail)return name;
 const noun=({Walking:'Walk',Hiking:'Hike',Running:'Run',Cycling:'Ride',MTB:'Mountain Bike Ride','Road cycling':'Ride'})[activityCode(activity)];
 if(!noun)return activity==='Driving'?`Drive to ${name}`:null;
 // Keep named National Parks; a generic Reserve suffix adds little to a walk name.
 return `${name.replace(/ Reserve$/i,'')} ${noun}`;
}
export function destinationVisits(journeys,timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone){
 const destinations=new Map();
 for(const trip of journeys){
  const place=trip.recognition?.primary;
  if(!place?.placeID||!place.supported||trip.endedAt==null||trip.state==='recording')continue;
  const day=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(trip.startedAt*1000));
  const entry=destinations.get(place.placeID)||{placeID:place.placeID,name:place.name,activities:[],days:new Set()};
  entry.days.add(day);entry.activities.push({id:trip.id,startedAt:trip.startedAt,activity:trip.activity,title:trip.title,day});destinations.set(place.placeID,entry);
 }
 return [...destinations.values()].map(({days,...entry})=>({...entry,visits:days.size,activities:entry.activities.sort((a,b)=>b.startedAt-a.startedAt)}));
}
