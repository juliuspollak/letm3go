import {metres} from './journeyGeometry.js';
export {metres} from './journeyGeometry.js';
import {assessRoutePlaces,destinationTitle,destinationVisits} from './journeyRecognition.js';
import {activityCode} from './activityNames.js';
import {ACTIVITY_TYPES} from './activityTypes.js';
import {personalPlace,namingPlace} from './rememberedPlace.js';
import {rankPlaceCandidates,placeTagPolicy} from './placeTagPolicy.js';
import {automaticTitle, contextualJourneyTitle} from './activityTitle.js';
import {recognisedStopVenue} from './stopVenueRecognition.js';
import {routeGaps,gapKey,snapshotCurrent,savedDistance} from './gapReconstruction.js';
// A non-destructive projection of existing recorded activities, not another recorder.
// Only account-scoped metadata is persisted; segment telemetry is never rewritten.
export const GROUPING_VERSION=1;
const edge=(a,b)=>JSON.stringify([a,b].sort());
const point=p=>p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180;
const endpoint=(t,end)=>t.points?.[end?t.points.length-1:0]||(end?t.endPoint:t.startPoint);
export const placeKey=p=>point(p)?`${p.latitude.toFixed(4)},${p.longitude.toFixed(4)}`:null;
// A stopped journey that may still be continued is a provisional record. It is
// not grouped, shared or backed up until the recorder finalises it.
export const isProvisional=t=>t?.details?.provisional===true;
export function emptyGrouping(owner){return {version:GROUPING_VERSION,owner,links:[],cuts:[],titles:{},types:{},places:{},stopEdits:{},history:[],sourceLinks:[],manualTags:{},hiddenTags:{},roads:{},enriched:{},distanceSummaries:{}};}
// Parsing and write authorization share one validator. A fallback may be shown,
// but must never replace an existing record that failed validation.
export function validateGrouping(m,owner){
 const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 try{
  if(!record(m)||m.version!==GROUPING_VERSION||m.owner!==owner||
   !['links','cuts','history'].every(key=>Array.isArray(m[key]))||
   !['titles','places','stopEdits'].every(key=>record(m[key]))||
   !['types','manualTags','hiddenTags','roads','enriched','distanceSummaries'].every(key=>m[key]==null||record(m[key]))||
   (m.sourceLinks!=null&&!Array.isArray(m.sourceLinks)))return null;
  const canonical=key=>{const pair=JSON.parse(key);if(!Array.isArray(pair)||pair.length!==2||!pair.every(id=>typeof id==='string'))throw new Error('Invalid pair');return edge(...pair);};
  const stopEdits={};
  for(const [key,value] of Object.entries(m.stopEdits)){
   const target=key.startsWith('[')?canonical(key):key;
   if(Object.hasOwn(stopEdits,target)&&JSON.stringify(stopEdits[target])!==JSON.stringify(value))return null;
   stopEdits[target]=value;
  }
  return {...emptyGrouping(owner),...m,links:m.links.map(canonical),cuts:m.cuts.map(canonical),stopEdits,types:m.types||{},manualTags:m.manualTags||{},hiddenTags:m.hiddenTags||{},roads:m.roads||{},enriched:m.enriched||{},distanceSummaries:m.distanceSummaries||{},sourceLinks:m.sourceLinks||[]};
 }catch{return null;}
}
export function parseGrouping(serialized,owner){return serialized?validateGrouping(safeParse(serialized),owner):emptyGrouping(owner);}
function safeParse(serialized){try{return JSON.parse(serialized);}catch{return null;}}
export function readGrouping(serialized,owner){return parseGrouping(serialized,owner)??emptyGrouping(owner);}
function vehicle(t,vehicles){if(t.vehicleID)return t.vehicleID;const matches=vehicles.filter(v=>v.name===t.vehicle);return matches.length===1?matches[0].id:null;}
function visibleTags(tags,segments,metadata){const ids=segments.map(s=>s.id);const hidden=new Set(ids.flatMap(id=>metadata.hiddenTags?.[id]||[]).map(x=>x.toLowerCase()));return [...new Set(tags.filter(t=>typeof t==='string'&&t.trim()&&!hidden.has(t.toLowerCase())))];}
function routeTags(activity,metadata){
 const policy=placeTagPolicy(activity.activity);
 if(!policy.route)return [];
 const points=activity.points||[];if(points.length<3)return [];
 const positions=[.2,.4,.6,.8].map(f=>Math.round((points.length-1)*f));
 const candidates=[];
 for(const index of positions){
  const record=metadata.places[placeKey(points[index])];if(!record)continue;
  for(const name of [record.nearbyName,...(record.categories||[])].filter(Boolean))candidates.push({name,kind:'route'});
 }
 return rankPlaceCandidates(candidates,{activity:activity.activity}).map(x=>x.name);
}
function activityPlaceTags(activity,from,to,stops=[]){
 const candidates=[];
 // On a Home round trip, a named intermediate visit is the destination.
 // Don't let the duplicate endpoint Home tag outrank that visit.
 const namedStop=stops.some(s=>s.meaningful&&s.nearbyName&&s.name.toLocaleLowerCase()!=='home');
 const homeRoundTrip=from.kind==='home'&&to.kind==='home'&&namedStop;
 if(!homeRoundTrip&&from.nearbyName)candidates.push({name:from.nearbyName,kind:from.kind?'saved':'start'});
 if(!homeRoundTrip&&to.nearbyName)candidates.push({name:to.nearbyName,kind:to.kind?'saved':'destination'});
 for(const stop of stops.filter(s=>s.meaningful)){
  if(stop.nearbyName)candidates.push({name:stop.nearbyName,kind:stop.kind?'saved':'stop'});
  else if(stop.locality||stop.name)candidates.push({name:stop.locality||stop.name,kind:'stop'});
 }
 return rankPlaceCandidates(candidates,{activity:activity.activity}).map(x=>x.name);
}
function geo(p,places,metadata){
 if(!point(p))return {name:'Unknown location',tags:[]};
 // Home and Work name a point before a favourite on top of them, then the tightest place (the rule the recorder titles trips with).
 const saved=namingPlace(places,p);
 const found=metadata.places[placeKey(p)]||{};
 return {name:saved?.name||found.nearbyName||found.locality||'Unnamed stop',locality:found.locality||'',nearbyName:saved?.name||found.nearbyName||'',kind:saved?.kind||'',tags:[...new Set([saved?.name,found.locality,found.region,found.nearbyName,...(found.categories||[])].filter(Boolean))],possibleCharging:found.possibleCharging===true,latitude:p.latitude,longitude:p.longitude};
}
// The recorder titles an automatic trip "<start place> → <end place>" from the saved places it began and ended in. Builds before the
// recorder's overlap rule (SavedPlace.names) took whichever of two overlapping places was saved first, so a favourite beside the house
// turned "Home → Plus Fitness" into "Morley Park → Plus Fitness" and the title was stored that way. A title that is still exactly that
// generated text is shown with Home or Work where the trip really started or ended; anything the person edited is left alone.
function nativeEndpointTitle(s,from,to){
 const details=s.details||{},start=details.startPlace,end=details.endPlace;
 if(s.recordingMode!=='automatic'||details.titleEdited||details.userCorrected||s.corrected||typeof start!=='string'||typeof end!=='string')return null;
 const title=s.title||'',generated=`${start} → ${end}`;
 // The recorder may add " · stopped N min" to a round trip that kept a possible destination.
 if(!title.startsWith(generated)||!/^( · stopped \d+ min)?$/.test(title.slice(generated.length)))return null;
 const named=(place,recorded)=>personalPlace(place)&&place.name?place.name:recorded;
 const repaired=`${named(from,start)} → ${named(to,end)}`;
 return repaired===generated?null:repaired+title.slice(generated.length);
}
function charging(stop,telemetry,owner,vehicleID){
 // Only verified provider evidence for this owner AND exact vehicle can confirm it.
 const confirmed=!!vehicleID&&telemetry.some(e=>e.verified===true&&e.ownerID===owner&&e.vehicleID===vehicleID&&e.type==='charging'&&e.startedAt<stop.endedAt&&e.endedAt>stop.startedAt&&(!point(e)||metres(e,stop)<=200));
 return confirmed?'confirmed':stop.possibleCharging?'possible':'none';
}
// Also recognise meaningful dwell clusters inside a segment without cutting its points.
export function internalStops(t,context){
 const result=[],points=t.points||[];let start=0;
 while(start<points.length){const first=points[start];if(!point(first)||first.accuracy>35){start++;continue;}let end=start+1;
  while(end<points.length&&points[end].segment===first.segment&&points[end].accuracy<=35&&points[end].timestamp-points[end-1].timestamp<=120&&metres(first,points[end])<=50)end++;
  const last=points[end-1];if(last.timestamp-first.timestamp>=300){const location=geo(first,context.places,context.metadata);const id=`dwell:${t.id}:${first.timestamp}`,manual=context.metadata.stopEdits[id]||{};const stop={id,segmentID:t.id,pointIndex:start,startedAt:first.timestamp,endedAt:last.timestamp,durationSeconds:last.timestamp-first.timestamp,...location,name:manual.name||location.nearbyName||location.locality||location.name,meaningful:true};stop.charging=charging(stop,context.telemetry,context.owner,vehicle(t,context.vehicles));stop.tags=manual.replaceTags?[...new Set(manual.tags||[])]:[...new Set([...location.tags,...(manual.tags||[]),...(stop.charging==='possible'?['Possible charging']:stop.charging==='confirmed'?['Charging']:[])])];if(!manual.ignored)result.push(stop);}start=Math.max(start+1,end);
 }
 return result;
}
// Stops the native recorder kept inside one activity (it paused, then continued).
// No route points exist during such a stop, so internalStops cannot see it. Only a
// stop it could not rule out as a destination is shown, as a possible one, so a
// round trip never hides where it stopped while traffic pauses and stops from
// earlier builds (no verdict) leave existing history unchanged. Edits use the
// same stopEdits keys.
export const NATIVE_STOP_SECONDS=180;
const STOP_VERDICT_TAGS={ambiguous:'Possible destination'};
export function nativeStops(t,context){
 const points=t.points||[];
 const first=points[t.visibleRouteStart??0],last=points[t.visibleRouteEnd??points.length-1];
 return (t.details?.stops||[]).filter(s=>STOP_VERDICT_TAGS[s?.verdict]&&Number.isFinite(s.start)&&Number.isFinite(s.end)&&s.end-s.start>=NATIVE_STOP_SECONDS).flatMap(s=>{
  // A stop in a trimmed-away part of the route is not shown.
  if(first&&s.end<=first.timestamp||last&&s.start>=last.timestamp)return [];
  const at=points.filter(p=>point(p)&&p.timestamp<=s.start).at(-1);
  if(!at)return [];
  const id=`native:${t.id}:${s.start}`,manual=context.metadata.stopEdits[id]||{},location=geo(at,context.places,context.metadata);
  // User stop corrections have priority over an automatically inferred venue.
  // A renamed stop must not keep the old POI as its tag or generated title.
  const renamed=typeof manual.name==='string'&&manual.name.trim().length>0;
  const venue=!renamed&&!location.kind?recognisedStopVenue(context.metadata.places[placeKey(at)],at,s.end-s.start):null;
  if(renamed){
   location.name=manual.name.trim();location.nearbyName=manual.name.trim();
   location.tags=[manual.name.trim()];
  } else if(venue){
   location.name=venue.name;location.nearbyName=venue.name;location.stopVenue=venue;
   location.tags=[...new Set([...location.tags,venue.name])];
  }
  const tag=STOP_VERDICT_TAGS[s.verdict];
  const stop={id,segmentID:t.id,pointIndex:points.indexOf(at),startedAt:s.start,endedAt:s.end,durationSeconds:s.end-s.start,...location,
   name:manual.name||location.nearbyName||location.locality||location.name,verdict:s.verdict||null,reasons:Array.isArray(s.reasons)?s.reasons.slice(0,8):[],meaningful:true};
  stop.charging=charging(stop,context.telemetry||[],context.owner,vehicle(t,context.vehicles||[]));
  stop.tags=manual.replaceTags?[...new Set(manual.tags||[])]:[...new Set([...location.tags,...(manual.tags||[]),...(tag?[tag]:[])])];
  return manual.ignored?[]:[stop];
 });
}
// The estimate replaces the displayed distance only; the recorded distance is
// kept beside it and the activity itself is unchanged.
function withEstimate(journey,estimate,metadata){
 if(!estimate)return journey;
 // Whether this activity's one-time lookup ran, for the recording report.
 estimate.lookup=metadata?.enriched?.[journey.id]?'done':!Number.isFinite(metadata?.enrichFrom)||journey.endedAt*1000<metadata.enrichFrom?'history':'pending';
 journey.recordedDistanceMeters=journey.distanceMeters;journey.distanceMeters=estimate.estimatedMeters;
 journey.distance=Math.round(estimate.estimatedMeters/100)/10;journey.distanceEstimate=estimate;return journey;
}
export function buildJourneys(activities,{owner,metadata=emptyGrouping(owner),places=[],vehicles=[],telemetry=[],projectionCache=null}={}){
 // All callers must supply the authenticated owner and an account-scoped input set.
 if(!owner)return {journeys:[],destinations:[]};
 if(metadata.owner!==owner)metadata=emptyGrouping(owner);
 const context={owner,metadata,places,vehicles,telemetry};
 const unique=new Map();
 for(const t of activities){if(isProvisional(t))continue;if((t.ownerID||t.owner_id)&&(t.ownerID||t.owner_id)!==owner)continue;const old=unique.get(t.id);if(!old||(t.updatedAt||0)>(old.updatedAt||0))unique.set(t.id,t);}
 const sorted=[...unique.values()].sort((a,b)=>a.startedAt-b.startedAt||a.id.localeCompare(b.id));
 if(projectionCache){const live=new Set(sorted.map(s=>`${owner}:${s.id}`));for(const key of projectionCache.keys())if(!live.has(key))projectionCache.delete(key);}
 const journeys=sorted.map(s=>{
  const cacheID=`${owner}:${s.id}`,previous=projectionCache?.get(cacheID);
   const keys=previous?.source===s?previous.keys:[...new Set((s.points||[]).map(placeKey))];
   // A saved distance summary (written once at save time) replaces the GPS gap scan.
   const saved=metadata.distanceSummaries?.[s.id];
   const gaps=previous?.source===s?previous.gaps:snapshotCurrent(s,saved)?(saved.summary?.gaps||[]):routeGaps(s);
   const recordKey=JSON.stringify([keys.map(key=>metadata.places[key]),gaps.map(g=>metadata.roads?.[g.key||gapKey(s.id,g)]),saved]);
   // Only this activity's own stop edits invalidate its projection.
   const ownStopEdits=Object.entries(metadata.stopEdits||{}).filter(([key])=>key.startsWith(`native:${s.id}:`)||key.startsWith(`dwell:${s.id}:`));
   const edits=JSON.stringify([metadata.titles[s.id],metadata.manualTags?.[s.id],metadata.hiddenTags?.[s.id],ownStopEdits,metadata.enriched?.[s.id]??null,metadata.enrichFrom??null]);
   if(previous?.source===s&&previous.recordKey===recordKey&&previous.edits===edits&&previous.places===places&&previous.vehicles===vehicles&&previous.telemetry===telemetry)return previous.journey;
   const from=geo(endpoint(s,false),places,metadata),to=geo(endpoint(s,true),places,metadata),stops=[...internalStops(s,context),...nativeStops(s,context)].sort((a,b)=>a.startedAt-b.startedAt);
   const recognition=assessRoutePlaces(s,[...(s.points||[]).map(p=>metadata.places[placeKey(p)]),{candidates:places.filter(p=>p.id).map(p=>({...p,placeID:`saved:${p.id}`,category:'savedPlace',userSaved:true}))}],{hidden:metadata.hiddenTags?.[s.id]||[]});
   // The end point lying inside a saved place is not enough to tag the trip with it:
   // only the place recognition says the activity ended at (its final run of fixes,
   // nearest of overlapping fences) is the saved destination. Home and Work, and the
   // "A → B" location line, keep the end point as they always have.
   const endedAt=recognition.candidates.find(c=>c.userSaved&&c.evidence.savedEnd)?.name;
   const toTag=to.kind&&!personalPlace(to)&&to.nearbyName!==endedAt?{...to,kind:'',nearbyName:metadata.places[placeKey(endpoint(s,true))]?.nearbyName||''}:to;
   const hiddenNames=new Set((metadata.hiddenTags?.[s.id]||[]).map(name=>String(name).trim().toLocaleLowerCase()));
   // A saved place (other than Home) at the stop names it as firmly as a rename.
   const destinationStop=stops.filter(stop=>stop.id.startsWith('native:')&&(stop.stopVenue||metadata.stopEdits[stop.id]?.name||(stop.kind&&stop.kind!=='home'))&&
     !hiddenNames.has(stop.name.toLocaleLowerCase())).sort((a,b)=>b.durationSeconds-a.durationSeconds)[0];
   const homeLoop=from.kind==='home'&&to.kind==='home'&&destinationStop;
   const stopTitle=homeLoop?`Home → ${destinationStop.name} → Home`:null;
   // A drive that ends at Home or Work is a drive home or to work. A park or
   // shop the car merely idled beside there (dwell or category evidence only, no saved-place
   // or route-coverage evidence) must not rename it "Drive to <nearby park>".
   // Only a place beside that end point is suppressed: a real stop elsewhere on a round trip keeps its title.
   const primary=recognition.primary,end=endpoint(s,true);
   const weakNearEnd=!!primary&&personalPlace(to)&&!primary.evidence?.savedEnd&&!primary.evidence?.routeSupported&&metres(primary,end)<=300;
   // A place the person saved on top of Home or Work (a park across the road saved as its own favourite) is not where they went: the
   // trip ended at home. Saved places outrank everything else, so without this every drive home read "Drive to <that place>".
   const overlapsPersonalEnd=!!primary&&personalPlace(to)&&metres(primary,end)<=150;
   const personalEnd=weakNearEnd||overlapsPersonalEnd;
   const generatedTitle=stopTitle||(personalEnd?null:destinationTitle(s.activity,primary))||((from.nearbyName||to.nearbyName)?contextualJourneyTitle(s.activity,from,to,metres(endpoint(s,false),endpoint(s,true))<100):null);
   // Native round-trip titles are generated by the recorder. A verified centre
   // or an explicit stop rename may replace them; user-edited titles still win.
   const nativeStopTitle=s.recordingMode==='automatic'&&!s.details?.titleEdited&&!s.details?.userCorrected&&
     /^Home → Home · stopped \d+ min$/.test(s.title||'');
   // A hidden inferred name must not survive in a previously projected title;
   // manual titles remain authoritative.
   const generatedNativeStopTitle=!!stopTitle&&nativeStopTitle;
   const journey={...s,recordedTitle:s.recordedTitle??s.title,recognition,generatedTitle,title:metadata.titles[s.id]||((automaticTitle(s)||s.titleIsAutomatic||generatedNativeStopTitle)?generatedTitle||s.title:s.title),location:from.name==='Unknown location'||from.name==='Unnamed stop'?s.location:`${from.name} → ${to.name}`,tags:visibleTags([...(s.tags||[]),...(metadata.manualTags?.[s.id]||[]),...activityPlaceTags(s,from,toTag,stops),...routeTags(s,metadata),...recognition.visited.map(p=>p.name)],[s],metadata),recognisedStops:stops};
   // A cached presentation describes the activity as it was saved. Once the activity
   // changes (a title edit bumps updatedAt) it is stale and must not override it. A list row
   // has no route loaded, so the point counts saved with the full route can never match:
   // only when it was last updated says whether the cache still describes it.
   const presentationCurrent=s.geometryLoaded===false?saved?.updatedAt===(s.updatedAt??null):snapshotCurrent(s,saved);
   const presentation=presentationCurrent?saved?.presentation:undefined;
   if(presentation&&s.geometryLoaded!==true){
    journey.title=metadata.titles[s.id]||presentation.title||journey.title;
    journey.location=presentation.location||journey.location;
    journey.tags=visibleTags([...(presentation.tags||[]),...(s.tags||[]),...(metadata.manualTags?.[s.id]||[])],[s],metadata);
    journey.recognisedStops=(presentation.recognisedStops||[]).flatMap(stop=>{
     const edit=metadata.stopEdits[stop.id];if(edit?.ignored)return [];
     return [{...stop,...(edit?.name?{name:edit.name}:{}),tags:edit?.replaceTags?edit.tags||[]:[...new Set([...(stop.tags||[]),...(edit?.tags||[])])]}];
    });
   }
   // Last, so a title or location cached with the activity (saved when it was enriched) cannot bring the wrong start place back. Only
   // while the title shown is still the recorder's own text: a title worked out from the places and stops (generatedTitle) is not.
   const repairedTitle=metadata.titles[s.id]||![s.title,presentation?.title].includes(journey.title)?null:nativeEndpointTitle(s,from,to);
   if(repairedTitle){
    journey.title=repairedTitle;
    if(from.name!=='Unknown location'&&from.name!=='Unnamed stop')journey.location=`${from.name} → ${to.name}`;
   }
   withEstimate(journey,savedDistance(s,metadata),metadata);
   projectionCache?.set(cacheID,{source:s,keys,gaps,recordKey,edits,places,vehicles,telemetry,journey});return journey;
 });
 // Place/stop text is indexed for singles as well as grouped journeys.
 for(const j of journeys){const stops=j.stops||j.recognisedStops||[];j.searchIndex=[j.title,j.location,j.collection,j.notes,...(j.tags||[]),...stops.flatMap(s=>[s.name,...s.tags])].filter(Boolean).join(' ').toLowerCase();}
 return {journeys,destinations:destinationVisits(journeys)};
}
export function changeGrouping(meta,action,{activities,owner,vehicles=[]}){
 if(meta.owner!==owner)throw new Error('Account changed. Grouping was not saved.');
 const next=structuredClone(meta);next.manualTags ||= {};const snapshot={links:meta.links,cuts:meta.cuts,titles:meta.titles,types:meta.types||{},stopEdits:meta.stopEdits,sourceLinks:meta.sourceLinks||[],manualTags:meta.manualTags||{},hiddenTags:meta.hiddenTags||{}};
 if(action.type==='undo'){
  const prior=next.history.pop();if(!prior)throw new Error('Nothing to undo.');
  if(!prior._touched)throw new Error('This older undo cannot safely change selectively cached history. Edit the journey directly.');
  for(const [field,keys] of Object.entries(prior._touched)){
   if(Array.isArray(next[field])){
    const keyOf=value=>Array.isArray(value)?JSON.stringify([...value].sort()):value;
    next[field]=next[field].filter(value=>!keys.includes(keyOf(value)));
    next[field].push(...prior[field]);
   }else for(const key of keys)if(Object.hasOwn(prior[field],key))next[field][key]=prior[field][key];else delete next[field][key];
  }
  return next;
 }
 const ordered=activities.filter(t=>!(t.ownerID||t.owner_id)||(t.ownerID||t.owner_id)===owner).sort((a,b)=>a.startedAt-b.startedAt||a.id.localeCompare(b.id));
 if(action.type==='manualTags'){
  if(!ordered.some(t=>t.id===action.anchor)||!Array.isArray(action.tags)||action.tags.length>20||action.tags.some(t=>typeof t!=='string'||t.length>50))throw new Error('Choose up to 20 short tags.');
  // One name however it was typed: "Bunnings", "bunnings " and "BUNNINGS " are
  // the same tag. The spelling typed first is kept.
  const seen=new Set();
  next.manualTags[action.anchor]=action.tags.map(t=>t.trim().replace(/\s+/g,' ')).filter(tag=>{
   const key=tag.toLocaleLowerCase();
   if(!tag||seen.has(key))return false;
   seen.add(key);return true;
  });
 }else if(action.type==='hideTag'){
  if(!ordered.some(t=>t.id===action.anchor)||typeof action.tag!=='string'||!action.tag.trim()||action.tag.length>60)throw new Error('Invalid tag.');
  const hidden=[...new Set([...(next.hiddenTags[action.anchor]||[]),action.tag.trim()])];
  if(hidden.length>60)throw new Error('Restore a hidden tag before hiding another; all 60 existing choices have been kept.');
  next.hiddenTags[action.anchor]=hidden;
 }else if(action.type==='restoreTag'){
  next.hiddenTags[action.anchor]=(next.hiddenTags[action.anchor]||[]).filter(t=>t.toLowerCase()!==action.tag?.toLowerCase());
 }else if(action.type==='sourceLink'){
  const trips=activities.filter(t=>action.ids.includes(t.id)&&(!t.ownerID||t.ownerID===owner||t.sharedToHousehold===true));const identity=t=>t.providerVehicleID||vehicles.find(v=>v.id===t.vehicleID||v.name===t.vehicle)?.teslaVehicleID||vehicle(t,vehicles);if(trips.length!==2||!identity(trips[0])||identity(trips[0])!==identity(trips[1]))throw new Error('Select matching recordings of your vehicle.');
  next.sourceLinks=[...(next.sourceLinks||[]),action.ids];
 }else if(action.type==='classify'){
  if(!ordered.some(t=>t.id===action.anchor)||!ACTIVITY_TYPES.includes(activityCode(action.activity)))throw new Error('Choose a supported journey activity type.');
  next.types[action.anchor]=activityCode(action.activity);
 }else if(action.type==='rename'){
  if(!ordered.some(t=>t.id===action.anchor)||!action.title?.trim()||action.title.length>150)throw new Error('Enter a journey name (up to 150 characters).');next.titles[action.anchor]=action.title.trim();
 }else if(action.type==='stop'){
  if(!action.id||!action.name?.trim()||action.name.length>100||action.tags?.some(t=>t.length>60))throw new Error('Enter a stop name and short tags.');next.stopEdits[action.id]={name:action.name.trim(),tags:(action.tags||[]).slice(0,20),replaceTags:action.replaceTags===true,ignored:action.ignored===true};
 }else throw new Error('Unsupported grouping change.');
 snapshot._touched={};
 for(const field of ['links','cuts','titles','types','stopEdits','sourceLinks','manualTags','hiddenTags']){
  if(Array.isArray(next[field])){
   const keyOf=value=>Array.isArray(value)?JSON.stringify([...value].sort()):value;
   const before=new Set((snapshot[field]||[]).map(keyOf)),after=new Set(next[field].map(keyOf));
   const touched=[...new Set([...before,...after])].filter(key=>before.has(key)!==after.has(key));
   if(touched.length){snapshot._touched[field]=touched;snapshot[field]=(snapshot[field]||[]).filter(value=>touched.includes(keyOf(value)));}else delete snapshot[field];
  }else{
   const touched=[...new Set([...Object.keys(snapshot[field]||{}),...Object.keys(next[field]||{})])].filter(key=>JSON.stringify(snapshot[field]?.[key])!==JSON.stringify(next[field]?.[key]));
   if(touched.length){snapshot._touched[field]=touched;snapshot[field]=Object.fromEntries(touched.filter(key=>Object.hasOwn(snapshot[field]||{},key)).map(key=>[key,snapshot[field][key]]));}else delete snapshot[field];
  }
 }
 next.history=[...next.history,snapshot].slice(-20);return next;
}

// Local unsent recordings cannot be discovered by a cloud scope. Include their
// existing grouping context without reading or scanning any GPS coordinates.
export function localJourneyRefs(activities,roots,metadata,limit=1000){
 const ids=new Set(roots),pairs=metadata?.sourceLinks||[];
 let changed=true;
 while(changed){changed=false;
  for(const pair of pairs)if(pair.some(id=>ids.has(id)))for(const id of pair)if(id&&!ids.has(id)){ids.add(id);changed=true;}
  if(ids.size>limit)return {ids:[...ids].slice(0,limit),incomplete:true};
 }
 return {ids:[...ids],incomplete:false};
}
