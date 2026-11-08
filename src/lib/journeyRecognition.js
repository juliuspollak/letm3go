import {activityCode} from './activityNames.js';
import {metres} from './journeyGeometry.js';

export const LOOKUP_VERSION=2;
const outdoor=new Set(['Walking','Hiking','Running','Cycling','MTB','Road cycling']);
const natural=new Set(['park','nationalPark','reserve','trail','lookout','landmark','savedPlace']);
const normalized=s=>String(s||'').trim().toLocaleLowerCase();
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
// A nearby pin is never containment. Promotion requires category plus substantial
// route evidence or measured dwell; POI search regions are never area boundaries.
export function assessRoutePlaces(trip,records=[],{hidden=[]}={}){
 const points=(trip.points||[]).filter(p=>Number.isFinite(p.accuracy)&&p.accuracy>=0&&p.accuracy<=40);
 // Every recorded fix, whatever its accuracy, for containment in a saved place:
 // the person's own statement about a location does not depend on the fix quality.
 const raw=(trip.points||[]).filter(p=>p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude));
 const excluded=new Set(hidden.map(normalized)),unique=new Map();
 for(const record of records)for(const raw of record?.candidates||[]){
  const category=/\bcar\s?park(?:ing)?$/i.test(raw?.name||'')?'parking':({'MKPOICategoryHiking':'trail','MKPOICategoryLandmark':'landmark'}[raw?.category]||raw?.category);
  const candidate={...raw,providerCategory:raw?.providerCategory||raw?.category,category};
  if(!candidate?.name||excluded.has(normalized(candidate.name))||(!candidate.userSaved&&/^(park|reserve|trail|car park|parking|lookout|nature|outdoors)$/i.test(candidate.name.trim())))continue;
  const key=candidate.placeID||`${normalized(candidate.name)}:${candidate.latitude}:${candidate.longitude}`;
  if(!unique.has(key))unique.set(key,candidate);
 }
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
  const savedRadius=candidate.userSaved?Math.max(50,Math.min(2000,Number(candidate.radius)||150)):0;
  const savedCoverage=savedRadius&&points.length?distances.filter(d=>d<=savedRadius).length/points.length:0;
  // A drive to a shop never covers the shop's radius, so a saved place is
  // recognised where the activity ended instead: the last fixes sit inside the
  // saved radius, with the final fix inside and at least two of the last three.
  // Home and Work are personal places, not destinations, and keep the existing
  // route-coverage rule so a drive home is never titled as a destination.
  const savedSensitive=candidate.userSaved===true&&['home','work'].includes(String(candidate.kind||'').toLocaleLowerCase());
  const insideRaw=raw.map(p=>metres(p,candidate)<=savedRadius);
  const savedEnd=!!savedRadius&&!savedSensitive&&raw.length>=2&&insideRaw.at(-1)===true&&insideRaw.slice(-3).filter(Boolean).length>=2;
  const savedSupported=savedEnd||(savedCoverage>=.7&&points.length>=3&&points.at(-1).timestamp-points[0].timestamp>=300);
  // Two saved places can overlap. The nearer one to where the activity ended is
  // the destination; the name breaks an exact tie, so matching never depends on
  // the order the places were saved in.
  const savedEndMetres=savedEnd?Math.min(...raw.slice(-3).map(p=>metres(p,candidate))):null;
  const supported=routeSupported||dwellSupported||savedSupported;
  const endpoint=[trip.points?.[0],trip.points?.at(-1)].some(p=>p&&metres(p,candidate)<=40);
  const confidence=supported?Math.min(.97,.72+(routeSupported ? .12 : 0)+(dwellSupported ? .08 : 0)+(candidate.placeID ? .03 : 0)):.25;
  // Where the person saved the place the activity ended at, that place is the
  // destination even if its name reads like parking ("Bunnings car park"): they
  // chose it as the end of the trip, not as a car park they merely passed.
  const role=supported?(candidate.category==='parking'&&!savedEnd?'startFinish':significant||savedEnd?'destination':'visited'):'nearby';
  // An explicit saved place outranks any POI inference: the person named this
  // location themselves, so no evidence score can overtake it. Within that tier
  // the place nearest the end of the activity ranks higher.
  const savedScore=savedEnd?1000+60-Math.min(20,savedEndMetres/10):0;
  return {...candidate,role,supported,confidence,score:savedScore+(routeSupported?50:0)+(dwellSupported?25:0)+(candidate.verifiedTrail?35:0)+({nationalPark:24,reserve:22,park:18,trail:16,lookout:12,landmark:10}[candidate.category]||0),
   evidence:{nearestMeters:Number.isFinite(nearest)?Math.round(nearest):null,routeCoverage:coverage,dwellSeconds:Math.round(dwellSeconds),endpoint,routeSupported,savedEnd,containment:savedSupported?'user-saved geofence':false},
   reason:supported?(savedEnd?'user-saved place where the activity ended':savedSupported?'user-saved geofence and sustained observations':routeSupported?'category and sustained route coverage':'observed dwell'):'insufficient visit evidence'};
 }).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name));
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
