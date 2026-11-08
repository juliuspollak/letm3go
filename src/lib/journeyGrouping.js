import {metres} from './journeyGeometry.js';
export {metres} from './journeyGeometry.js';
import {assessRoutePlaces,destinationTitle,destinationVisits} from './journeyRecognition.js';
import {activityCode} from './activityNames.js';
import {rankPlaceCandidates,placeTagPolicy} from './placeTagPolicy.js';
import {automaticTitle, contextualJourneyTitle} from './activityTitle.js';
import {recognisedStopVenue} from './stopVenueRecognition.js';
import {routeGaps,gapKey,snapshotCurrent,savedDistance,combineEstimates} from './gapReconstruction.js';
// A non-destructive projection of existing recorded activities, not another recorder.
// Only account-scoped metadata is persisted; segment telemetry is never rewritten.
export const GROUPING_VERSION=1;
const moving=t=>(t.activity==='Driving'||t.activity==='Unknown')&&t.endedAt!=null&&t.state!=='recording';
const point=p=>p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180;
const edge=(a,b)=>JSON.stringify([a,b].sort());
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
 const saved=[...places].filter(s=>metres(s,p)<=Math.min(s.radius||150,2000)).sort((a,b)=>metres(a,p)-metres(b,p))[0];
 const found=metadata.places[placeKey(p)]||{};
 return {name:saved?.name||found.nearbyName||found.locality||'Unnamed stop',locality:found.locality||'',nearbyName:saved?.name||found.nearbyName||'',kind:saved?.kind||'',tags:[...new Set([saved?.name,found.locality,found.region,found.nearbyName,...(found.categories||[])].filter(Boolean))],possibleCharging:found.possibleCharging===true,latitude:p.latitude,longitude:p.longitude};
}
function charging(stop,telemetry,owner,vehicleID){
 // Only verified provider evidence for this owner AND exact vehicle can confirm it.
 const confirmed=!!vehicleID&&telemetry.some(e=>e.verified===true&&e.ownerID===owner&&e.vehicleID===vehicleID&&e.type==='charging'&&e.startedAt<stop.endedAt&&e.endedAt>stop.startedAt&&(!point(e)||metres(e,stop)<=200));
 return confirmed?'confirmed':stop.possibleCharging?'possible':'none';
}
function makeStop(a,b,{places,metadata,telemetry,owner,vehicles}){
 const p=endpoint(a,true),start=a.endedAt,end=b.startedAt;
 if(!point(p)||end<=start||metres(p,endpoint(b,false))>500)return null;
 const id=edge(a.id,b.id),location=geo(p,places,metadata),manual=metadata.stopEdits[id]||{};
 const stop={id,afterSegmentID:a.id,beforeSegmentID:b.id,startedAt:start,endedAt:end,durationSeconds:end-start,...location};
 stop.charging=charging(stop,telemetry,owner,vehicle(a,vehicles));
 stop.name=manual.name||location.nearbyName||location.locality||location.name;
 stop.tags=[...new Set([...location.tags,...(manual.tags||[]),...(stop.charging==='confirmed'?['Charging']:stop.charging==='possible'?['Possible charging']:[])])];
 if(manual.replaceTags)stop.tags=[...new Set(manual.tags||[])];
 stop.meaningful=!manual.ignored&&(stop.durationSeconds>=300||(stop.durationSeconds>=180&&(stop.charging!=='none'||!!location.nearbyName)));
 return stop;
}
export function continuation(a,b,stop,{vehicles=[],places=[],metadata,owner}){
 if(!moving(a)||!moving(b)||a.ownerID&&a.ownerID!==owner||b.ownerID&&b.ownerID!==owner)return {decision:'separate',reason:'Different account or non-driving activity'};
 const av=vehicle(a,vehicles),bv=vehicle(b,vehicles);
 if(av&&bv&&av!==bv)return {decision:'separate',reason:'Different vehicles'};
 if(!stop)return {decision:'separate',reason:'Overlapping times or disconnected routes'};
 // The iPhone recognised this stop as a destination and split the drive there.
 // Decided before vehicle and title checks: automatic drives usually have no
 // vehicle. A short stop between long drives still groups as a road trip.
 const destination=a.details?.destinationStop;
 const longDrive=(a.distanceMeters>=30000&&b.distanceMeters>=30000)||a.distanceMeters>=80000||b.distanceMeters>=80000;
 if(destination&&Number.isFinite(destination.start)&&Math.abs(destination.start-a.endedAt)<=120){
  // The phone split a long drive at a stop: as one native activity it would have
  // been one drive, so it still groups as a road trip, whatever the vehicle.
  // Not across a saved Home or Work stop, and not over two titles the person gave.
  if(longDrive&&stop.durationSeconds<=90*60&&!['home','work'].includes(stop.kind)&&!(metadata.titles[a.id]&&metadata.titles[b.id]&&metadata.titles[a.id]!==metadata.titles[b.id]))
   return {decision:'auto',reason:'Short stop between long drives'};
  return {decision:'separate',reason:'Destination recognised between these drives'};
 }
 if(a.activity!=='Driving'||b.activity!=='Driving')return {decision:'suggest',reason:'Unclassified journey — confirm both recordings belong to the same drive'};
 if(stop.durationSeconds>24*3600)return {decision:'separate',reason:'More than one day apart'};
 if(['home','work'].includes(stop.kind))return {decision:'separate',reason:`Stopped at ${stop.kind}`};
 const from=endpoint(a,false),to=endpoint(b,true);
 const home=places.find(p=>p.kind==='home');
 if(home&&metres(to,home)<=(home.radius||150)&&a.distanceMeters<30000&&b.distanceMeters<30000)return {decision:'separate',reason:'Local return home'};
 const fromHome=home&&metres(from,home)<=(home.radius||150);
 if(stop.durationSeconds>=6*3600)return {decision:'suggest',reason:'Long or overnight break — confirm continuation'};
 if(new Date(a.endedAt*1000).toDateString()!==new Date(b.startedAt*1000).toDateString()&&stop.durationSeconds>3*3600)return {decision:'suggest',reason:'Overnight continuation — confirm'};
 if(!av||!bv)return {decision:'suggest',reason:'Vehicle not identified — confirm these drives belong together'};
 if(metadata.titles[a.id]&&metadata.titles[b.id]&&metadata.titles[a.id]!==metadata.titles[b.id])return {decision:'suggest',reason:'Both journeys have your titles'};
 if(stop.charging==='confirmed'&&stop.durationSeconds<=2*3600)return {decision:'auto',reason:'Confirmed charging between drives'};
 if(longDrive&&stop.durationSeconds<=90*60)return {decision:'auto',reason:stop.charging==='possible'?'Road-trip continuation near charging infrastructure':'Short stop between long drives'};
 if(stop.durationSeconds<180&&!fromHome)return {decision:'auto',reason:'Brief interruption in the same drive'};
 return {decision:'suggest',reason:'Nearby drives — confirm continuation'};
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
 if(!owner)return {journeys:[],suggestions:[]};
 if(metadata.owner!==owner)metadata=emptyGrouping(owner);
 const context={owner,metadata,places,vehicles,telemetry};
 const unique=new Map();
 for(const t of activities){if(isProvisional(t))continue;if((t.ownerID||t.owner_id)&&(t.ownerID||t.owner_id)!==owner)continue;const old=unique.get(t.id);if(!old||(t.updatedAt||0)>(old.updatedAt||0))unique.set(t.id,t);}
 const sorted=[...unique.values()].sort((a,b)=>a.startedAt-b.startedAt||a.id.localeCompare(b.id));
 const positions=new Map(sorted.map((s,i)=>[s.id,i]));
 const cutRanges=metadata.cuts.flatMap(k=>{try{const [after,before]=JSON.parse(k),a=positions.get(after),b=positions.get(before);return a!=null&&b!=null?[[Math.min(a,b),Math.max(a,b)]]:[];}catch{return [];}});
 const groups=[],suggestions=[];let previous;
 const drives=sorted.filter(moving);
 for(const t of drives){const group=groups.at(-1),stop=previous?makeStop(previous,t,context):null;
  let verdict=previous?continuation(previous,t,stop,context):{decision:'separate'};
  const currentTitle=group?.map(s=>metadata.titles[s.id]).find(Boolean);
  if(verdict.decision==='auto'&&currentTitle&&metadata.titles[t.id]&&currentTitle!==metadata.titles[t.id])verdict={decision:'suggest',reason:'Both journeys have your titles'};
  const key=previous?edge(previous.id,t.id):'';
  const previousVehicle=previous?vehicle(previous,vehicles):null,currentVehicle=vehicle(t,vehicles);
  const manual=metadata.links.includes(key)&&previous?.endedAt!=null&&t.startedAt>=previous.endedAt&&t.startedAt-previous.endedAt<=86400&&(!previousVehicle||!currentVehicle||previousVehicle===currentVehicle);
  const cut=cutRanges.some(([a,b])=>(positions.get(previous?.id)??-1)>=a&&(positions.get(t.id)??Infinity)<=b);
  if(group&&!cut&&((moving(previous)&&moving(t)&&verdict.decision==='auto')||manual))group.push(t);
  else {if(verdict.decision==='suggest'&&!cut)suggestions.push({id:key,segmentIDs:[previous.id,t.id],reason:verdict.reason,stop});groups.push([t]);}
  previous=t;
 }
 groups.push(...sorted.filter(t=>!moving(t)).map(t=>[t]));
 // Apply explicit cross-activity links after drive-only automatic grouping.
 // This preserves automatic drive continuations across unrelated walks.
 for(const key of metadata.links){
  let ids;try{ids=JSON.parse(key);}catch{continue;}
  if(!Array.isArray(ids)||ids.length!==2)continue;
  const a=groups.findIndex(g=>g.some(t=>t.id===ids[0]));
  const b=groups.findIndex(g=>g.some(t=>t.id===ids[1]));
  if(a<0||b<0||a===b)continue;
  const [left,right]=ids.map(id=>sorted.find(t=>t.id===id)).sort((x,y)=>(x?.startedAt??0)-(y?.startedAt??0));
  if(!left||!right||left.endedAt==null||right.startedAt<left.endedAt||right.startedAt-left.endedAt>86400)continue;
  if(metadata.cuts.includes(key))continue;
  const merged=[...groups[a],...groups[b]].sort((x,y)=>x.startedAt-y.startedAt||x.id.localeCompare(y.id));
  groups.splice(Math.max(a,b),1);groups.splice(Math.min(a,b),1,merged);
 }
 if(projectionCache){const live=new Set(sorted.map(s=>`${owner}:${s.id}`));for(const key of projectionCache.keys())if(!live.has(key))projectionCache.delete(key);}
 const journeys=groups.map(segments=>{
  if(segments.length===1){const s=segments[0],cacheID=`${owner}:${s.id}`,previous=projectionCache?.get(cacheID);
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
   const hiddenNames=new Set((metadata.hiddenTags?.[s.id]||[]).map(name=>String(name).trim().toLocaleLowerCase()));
   // A saved place (other than Home) at the stop names it as firmly as a rename.
   const destinationStop=stops.filter(stop=>stop.id.startsWith('native:')&&(stop.stopVenue||metadata.stopEdits[stop.id]?.name||(stop.kind&&stop.kind!=='home'))&&
     !hiddenNames.has(stop.name.toLocaleLowerCase())).sort((a,b)=>b.durationSeconds-a.durationSeconds)[0];
   const homeLoop=from.kind==='home'&&to.kind==='home'&&destinationStop;
   const stopTitle=homeLoop?`Home → ${destinationStop.name} → Home`:null;
   const generatedTitle=stopTitle||destinationTitle(s.activity,recognition.primary)||((from.nearbyName||to.nearbyName)?contextualJourneyTitle(s.activity,from,to,metres(endpoint(s,false),endpoint(s,true))<100):null);
   // Native round-trip titles are generated by the recorder. A verified centre
   // or an explicit stop rename may replace them; user-edited titles still win.
   const nativeStopTitle=s.recordingMode==='automatic'&&!s.details?.titleEdited&&!s.details?.userCorrected&&
     /^Home → Home · stopped \d+ min$/.test(s.title||'');
   // A hidden inferred name must not survive in a previously projected title;
   // manual titles remain authoritative.
   const generatedNativeStopTitle=!!stopTitle&&nativeStopTitle;
   const journey={...s,recordedTitle:s.recordedTitle??s.title,recognition,generatedTitle,title:metadata.titles[s.id]||((automaticTitle(s)||s.titleIsAutomatic||generatedNativeStopTitle)?generatedTitle||s.title:s.title),location:from.name==='Unknown location'||from.name==='Unnamed stop'?s.location:`${from.name} → ${to.name}`,tags:visibleTags([...(s.tags||[]),...(metadata.manualTags?.[s.id]||[]),...activityPlaceTags(s,from,to,stops),...routeTags(s,metadata),...recognition.visited.map(p=>p.name)],[s],metadata),recognisedStops:stops};
   const presentation=saved?.presentation;
   if(presentation&&s.geometryLoaded!==true){
    journey.title=metadata.titles[s.id]||presentation.title||journey.title;
    journey.location=presentation.location||journey.location;
    journey.tags=visibleTags([...(presentation.tags||[]),...(s.tags||[]),...(metadata.manualTags?.[s.id]||[])],[s],metadata);
    journey.recognisedStops=(presentation.recognisedStops||[]).flatMap(stop=>{
     const edit=metadata.stopEdits[stop.id];if(edit?.ignored)return [];
     return [{...stop,...(edit?.name?{name:edit.name}:{}),tags:edit?.replaceTags?edit.tags||[]:[...new Set([...(stop.tags||[]),...(edit?.tags||[])])]}];
    });
   }
   withEstimate(journey,savedDistance(s,metadata),metadata);
   projectionCache?.set(cacheID,{source:s,keys,gaps,recordKey,edits,places,vehicles,telemetry,journey});return journey;}
  const first=segments[0],last=segments.at(-1),start=geo(endpoint(first,false),places,metadata),end=geo(endpoint(last,true),places,metadata);
  const stops=segments.flatMap(t=>{
   const saved=metadata.distanceSummaries?.[t.id]?.presentation;
   if(t.geometryLoaded!==true&&saved?.recognisedStops)return saved.recognisedStops.flatMap(stop=>{
    const edit=metadata.stopEdits[stop.id];if(edit?.ignored)return [];
    return [{...stop,...(edit?.name?{name:edit.name}:{}),tags:edit?.replaceTags?edit.tags||[]:[...new Set([...(stop.tags||[]),...(edit?.tags||[])])]}];
   });
   return [...internalStops(t,context),...nativeStops(t,context)];
  });
  for(let i=1;i<segments.length;i++){const s=makeStop(segments[i-1],segments[i],context);if(s?.meaningful)stops.push(s);}
  stops.sort((a,b)=>a.startedAt-b.startedAt);
  const manualTitle=segments.map(s=>metadata.titles[s.id]).find(Boolean);
  const tags=visibleTags([...segments.flatMap(s=>[...(s.tags||[]),...(s.geometryLoaded!==true?metadata.distanceSummaries?.[s.id]?.presentation?.tags||[]:[])]),...segments.flatMap(s=>metadata.manualTags?.[s.id]||[]),...activityPlaceTags(first,start,end,stops),...segments.flatMap(s=>routeTags(s,metadata))],segments,metadata);
  const estimates=segments.map(s=>savedDistance(s,metadata)),estimate=combineEstimates(segments,estimates);
  const distanceMeters=segments.reduce((n,s,i)=>n+(estimates[i]?.estimatedMeters??(s.distanceMeters||0)),0),durationSeconds=segments.reduce((n,s)=>n+(s.durationSeconds||0),0);
  return {...first,activity:metadata.types[first.id]||first.activity,id:`journey:${first.id}`,isGroupedJourney:true,segmentIDs:segments.map(s=>s.id),segments:segments.map((s,i)=>estimates[i]?withEstimate({...s},estimates[i],metadata):s),stops,title:manualTitle||contextualJourneyTitle(metadata.types[first.id]||first.activity,start,end,metres(endpoint(first,false),endpoint(last,true))<700),titleIsAutomatic:!manualTitle,endedAt:last.endedAt,startedAt:first.startedAt,distanceMeters,distance:Math.round(distanceMeters/100)/10,durationSeconds,minutes:Math.floor(durationSeconds/60),elapsedSeconds:last.endedAt-first.startedAt,tags,notes:segments.map(s=>s.notes||'').join(' '),location:`${start.name} → ${end.name}`,route:[],routeSegments:segments.flatMap(s=>s.routeSegments||[]),photos:segments.flatMap(s=>s.photos||[]),source:null,...(estimate?{recordedDistanceMeters:estimate.recordedMeters,distanceEstimate:estimate}:{})};
 });
 // Place/stop text is indexed for singles as well as grouped journeys.
 for(const j of journeys){const stops=j.stops||j.recognisedStops||[];j.searchIndex=[j.title,j.location,j.collection,j.notes,...(j.tags||[]),...stops.flatMap(s=>[s.name,...s.tags])].filter(Boolean).join(' ').toLowerCase();}
 return {journeys,suggestions,destinations:destinationVisits(journeys)};
}
export function changeGrouping(meta,action,{activities,owner,vehicles=[],places=[]}){
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
  next.manualTags[action.anchor]=[...new Set(action.tags.map(t=>t.trim()).filter(Boolean))];
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
 }else if(action.type==='merge'){
  const selected=new Set(action.ids);const trips=ordered.filter(t=>selected.has(t.id));
  if(trips.length<2||trips.length!==selected.size||trips.some(t=>t.endedAt==null||t.state==='recording'))throw new Error('Select at least two completed activities.');
  const indices=trips.map(t=>ordered.indexOf(t));if(indices.at(-1)-indices[0]+1!==trips.length)throw new Error('Select consecutive activities; an intervening activity must not be skipped.');
  const known=new Set(trips.map(t=>vehicle(t,vehicles)).filter(Boolean));if(known.size>1)throw new Error('Journeys from different vehicles cannot be merged.');
  for(let i=1;i<trips.length;i++){
   const stop=makeStop(trips[i-1],trips[i],{owner,metadata:meta,places,vehicles,telemetry:[]});
   const gap=trips[i].startedAt-trips[i-1].endedAt;
   if(gap<0||gap>86400)throw new Error('These activities overlap or are more than a day apart.');
   if(moving(trips[i-1])&&moving(trips[i])&&!stop)throw new Error('These driving routes are disconnected.');
   const key=edge(trips[i-1].id,trips[i].id);next.links=[...new Set([...next.links,key])];next.cuts=next.cuts.filter(k=>k!==key);
  }
 }else if(action.type==='split'){
  const a=ordered.find(t=>t.id===action.after),b=ordered.find(t=>t.id===action.before);
  if(!a||!b)throw new Error('Segment not found.');const key=edge(a.id,b.id);next.cuts=[...new Set([...next.cuts,key])];next.links=next.links.filter(k=>k!==key);
 }else if(action.type==='classify'){
  if(!ordered.some(t=>t.id===action.anchor)||!['Driving','Walking','Running','Cycling','MTB','Road cycling','Kitesurfing','Hiking','Other','Unknown'].includes(activityCode(action.activity)))throw new Error('Choose a supported journey activity type.');
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
 const ids=new Set(roots),ordered=activities.filter(moving).sort((a,b)=>a.startedAt-b.startedAt||a.id.localeCompare(b.id));
 const positions=new Map(ordered.map((trip,index)=>[trip.id,index]));
 const pairs=[...(metadata?.links||[]).map(key=>{try{return JSON.parse(key);}catch{return [];}}),...(metadata?.sourceLinks||[])];
 let changed=true;
 while(changed){changed=false;const add=id=>{if(id&&!ids.has(id)){ids.add(id);changed=true;}};
  for(const pair of pairs)if(pair.some(id=>ids.has(id)))for(const id of pair)add(id);
  for(const id of [...ids]){const index=positions.get(id);if(index===undefined)continue;const trip=ordered[index];
   for(const neighbour of [ordered[index-1],ordered[index+1]])if(neighbour&&Math.max(trip.startedAt,neighbour.startedAt)-Math.min(trip.endedAt,neighbour.endedAt)<=21600)add(neighbour.id);
  }
  if(ids.size>limit)return {ids:[...ids].slice(0,limit),incomplete:true};
 }
 return {ids:[...ids],incomplete:false};
}
