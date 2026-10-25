// A non-destructive projection of existing recorded activities, not another recorder.
// Only account-scoped metadata is persisted; segment telemetry is never rewritten.
export const GROUPING_VERSION=1;
const moving=t=>(t.activity==='Driving'||t.activity==='Unknown')&&t.endedAt!=null&&t.state!=='recording';
const point=p=>p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180;
export function metres(a,b){if(!point(a)||!point(b))return Infinity;const r=Math.PI/180,dlat=(b.latitude-a.latitude)*r,dlon=(b.longitude-a.longitude)*r,x=Math.sin(dlat/2)**2+Math.cos(a.latitude*r)*Math.cos(b.latitude*r)*Math.sin(dlon/2)**2;return 6371000*2*Math.atan2(Math.sqrt(x),Math.sqrt(Math.max(0,1-x)));}
const edge=(a,b)=>JSON.stringify([a,b]);
const endpoint=(t,end)=>t.points?.[end?t.points.length-1:0];
export const placeKey=p=>point(p)?`${p.latitude.toFixed(4)},${p.longitude.toFixed(4)}`:null;
export function emptyGrouping(owner){return {version:GROUPING_VERSION,owner,links:[],cuts:[],titles:{},places:{},stopEdits:{},history:[],sourceLinks:[]};}
export function readGrouping(serialized,owner){try{const m=JSON.parse(serialized);if(m.version!==1||m.owner!==owner||!Array.isArray(m.links)||!Array.isArray(m.cuts)||!m.titles||!m.places||!m.stopEdits||!Array.isArray(m.history))return emptyGrouping(owner);return {...emptyGrouping(owner),...m};}catch{return emptyGrouping(owner);}}
function vehicle(t,vehicles){if(t.vehicleID)return t.vehicleID;const matches=vehicles.filter(v=>v.name===t.vehicle);return matches.length===1?matches[0].id:null;}
function geo(p,places,metadata){
 if(!point(p))return {name:'Unknown location',tags:[]};
 const saved=places.find(s=>metres(s,p)<=Math.min(s.radius||100,2000));
 const found=metadata.places[placeKey(p)]||{};
 return {name:saved?.name||found.locality||found.nearbyName||'Unnamed stop',locality:found.locality||'',nearbyName:found.nearbyName||'',kind:saved?.kind||'',tags:[...new Set([saved?.name,found.locality,found.region,found.nearbyName,...(found.categories||[])].filter(Boolean))],possibleCharging:found.possibleCharging===true,latitude:p.latitude,longitude:p.longitude};
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
 stop.name=manual.name||location.locality||location.name;
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
 const longDrive=(a.distanceMeters>=30000&&b.distanceMeters>=30000)||a.distanceMeters>=80000||b.distanceMeters>=80000;
 if(longDrive&&stop.durationSeconds<=90*60)return {decision:'auto',reason:stop.charging==='possible'?'Road-trip continuation near charging infrastructure':'Short stop between long drives'};
 if(stop.durationSeconds<180&&!fromHome)return {decision:'auto',reason:'Brief interruption in the same drive'};
 return {decision:'suggest',reason:'Nearby drives — confirm continuation'};
}
// Also recognise meaningful dwell clusters inside a segment without cutting its points.
export function internalStops(t,context){
 const result=[],points=t.points||[];let start=0;
 while(start<points.length){const first=points[start];if(!point(first)||first.accuracy>35){start++;continue;}let end=start+1;
  while(end<points.length&&points[end].segment===first.segment&&points[end].accuracy<=35&&points[end].timestamp-points[end-1].timestamp<=120&&metres(first,points[end])<=50)end++;
  const last=points[end-1];if(last.timestamp-first.timestamp>=300){const location=geo(first,context.places,context.metadata);const id=`dwell:${t.id}:${first.timestamp}`,manual=context.metadata.stopEdits[id]||{};const stop={id,segmentID:t.id,pointIndex:start,startedAt:first.timestamp,endedAt:last.timestamp,durationSeconds:last.timestamp-first.timestamp,...location,name:manual.name||location.locality||location.name,meaningful:true};stop.charging=charging(stop,context.telemetry,context.owner,vehicle(t,context.vehicles));stop.tags=manual.replaceTags?[...new Set(manual.tags||[])]:[...new Set([...location.tags,...(manual.tags||[]),...(stop.charging==='possible'?['Possible charging']:stop.charging==='confirmed'?['Charging']:[])])];if(!manual.ignored)result.push(stop);}start=Math.max(start+1,end);
 }
 return result;
}
export function buildJourneys(activities,{owner,metadata=emptyGrouping(owner),places=[],vehicles=[],telemetry=[]}={}){
 // All callers must supply the authenticated owner and an account-scoped input set.
 if(!owner)return {journeys:[],suggestions:[]};
 if(metadata.owner!==owner)metadata=emptyGrouping(owner);
 const context={owner,metadata,places,vehicles,telemetry};
 const unique=new Map();
 for(const t of activities){if((t.ownerID||t.owner_id)&&(t.ownerID||t.owner_id)!==owner)continue;const old=unique.get(t.id);if(!old||(t.updatedAt||0)>(old.updatedAt||0))unique.set(t.id,t);}
 const sorted=[...unique.values()].sort((a,b)=>a.startedAt-b.startedAt||a.id.localeCompare(b.id));
 const positions=new Map(sorted.map((s,i)=>[s.id,i]));
 const cutRanges=metadata.cuts.flatMap(k=>{try{const [after,before]=JSON.parse(k),a=positions.get(after),b=positions.get(before);return a!=null&&b!=null?[[a,b]]:[];}catch{return [];}});
 const groups=[],suggestions=[];let previous;
 const drives=sorted.filter(moving);
 for(const t of drives){const group=groups.at(-1),stop=previous?makeStop(previous,t,context):null;
  let verdict=previous?continuation(previous,t,stop,context):{decision:'separate'};
  const currentTitle=group?.map(s=>metadata.titles[s.id]).find(Boolean);
  if(verdict.decision==='auto'&&currentTitle&&metadata.titles[t.id]&&currentTitle!==metadata.titles[t.id])verdict={decision:'suggest',reason:'Both journeys have your titles'};
  const key=previous?edge(previous.id,t.id):'';
  const previousVehicle=previous?vehicle(previous,vehicles):null,currentVehicle=vehicle(t,vehicles);
  const manual=metadata.links.includes(key)&&stop&&stop.durationSeconds<=86400&&(!previousVehicle||!currentVehicle||previousVehicle===currentVehicle);
  const cut=cutRanges.some(([a,b])=>(positions.get(previous?.id)??-1)>=a&&(positions.get(t.id)??Infinity)<=b);
  if(group&&moving(previous)&&moving(t)&&!cut&&(verdict.decision==='auto'||manual))group.push(t);
  else {if(verdict.decision==='suggest'&&!cut)suggestions.push({id:key,segmentIDs:[previous.id,t.id],reason:verdict.reason,stop});groups.push([t]);}
  previous=t;
 }
 groups.push(...sorted.filter(t=>!moving(t)).map(t=>[t]));
 const journeys=groups.map(segments=>{
  if(segments.length===1){const s=segments[0],from=geo(endpoint(s,false),places,metadata),to=geo(endpoint(s,true),places,metadata);return {...s,title:metadata.titles[s.id]||s.title,location:from.name==='Unknown location'||from.name==='Unnamed stop'?s.location:`${from.name} → ${to.name}`,tags:[...new Set([...(s.tags||[]),...from.tags,...to.tags])],recognisedStops:internalStops(s,context)};}
  const first=segments[0],last=segments.at(-1),start=geo(endpoint(first,false),places,metadata),end=geo(endpoint(last,true),places,metadata);
  const stops=segments.flatMap(t=>internalStops(t,context));
  for(let i=1;i<segments.length;i++){const s=makeStop(segments[i-1],segments[i],context);if(s?.meaningful)stops.push(s);}
  stops.sort((a,b)=>a.startedAt-b.startedAt);
  const manualTitle=segments.map(s=>metadata.titles[s.id]).find(Boolean);
  const tags=[...new Set([...segments.flatMap(s=>s.tags||[]),...start.tags,...end.tags,...stops.flatMap(s=>[s.name,...s.tags])])];
  const distanceMeters=segments.reduce((n,s)=>n+(s.distanceMeters||0),0),durationSeconds=segments.reduce((n,s)=>n+(s.durationSeconds||0),0);
  return {...first,id:`journey:${first.id}`,isGroupedJourney:true,segmentIDs:segments.map(s=>s.id),segments,stops,title:manualTitle||`${start.locality||start.name.replace('Unnamed stop','Start')} → ${end.locality||end.name.replace('Unnamed stop','Destination')}`,titleIsAutomatic:!manualTitle,endedAt:last.endedAt,startedAt:first.startedAt,distanceMeters,distance:Math.round(distanceMeters/100)/10,durationSeconds,minutes:Math.floor(durationSeconds/60),elapsedSeconds:last.endedAt-first.startedAt,tags,notes:segments.map(s=>s.notes||'').join(' '),location:`${start.name} → ${end.name}`,route:[],routeSegments:segments.flatMap(s=>s.routeSegments||[]),photos:segments.flatMap(s=>s.photos||[]),source:null};
 });
 // Place/stop text is indexed for singles as well as grouped journeys.
 for(const j of journeys){const stops=j.stops||j.recognisedStops||[];j.searchIndex=[j.title,j.location,j.collection,j.notes,...(j.tags||[]),...stops.flatMap(s=>[s.name,...s.tags])].filter(Boolean).join(' ').toLowerCase();}
 return {journeys,suggestions};
}
export function changeGrouping(meta,action,{activities,owner,vehicles=[],places=[]}){
 if(meta.owner!==owner)throw new Error('Account changed. Grouping was not saved.');
 const next=structuredClone(meta);const snapshot={links:meta.links,cuts:meta.cuts,titles:meta.titles,stopEdits:meta.stopEdits,sourceLinks:meta.sourceLinks||[]};
 if(action.type==='undo'){const prior=next.history.pop();if(!prior)throw new Error('Nothing to undo.');return {...next,...prior};}
 const ordered=activities.filter(t=>!(t.ownerID||t.owner_id)||(t.ownerID||t.owner_id)===owner).sort((a,b)=>a.startedAt-b.startedAt||a.id.localeCompare(b.id));
 if(action.type==='sourceLink'){
  const trips=activities.filter(t=>action.ids.includes(t.id)&&(!t.ownerID||t.ownerID===owner||t.sharedToHousehold===true));const identity=t=>t.providerVehicleID||vehicles.find(v=>v.id===t.vehicleID||v.name===t.vehicle)?.teslaVehicleID||vehicle(t,vehicles);if(trips.length!==2||!identity(trips[0])||identity(trips[0])!==identity(trips[1]))throw new Error('Select matching recordings of your vehicle.');
  next.sourceLinks=[...(next.sourceLinks||[]),action.ids];
 }else if(action.type==='merge'){
  const selected=new Set(action.ids);const trips=ordered.filter(t=>selected.has(t.id));
  if(trips.length<2||trips.length!==selected.size||trips.some(t=>!moving(t)))throw new Error('Select at least two of your recorded drives.');
  const driving=ordered.filter(moving);const indices=trips.map(t=>driving.indexOf(t));if(indices.at(-1)-indices[0]+1!==trips.length)throw new Error('Select consecutive drives; an intervening activity must not be skipped.');
  const known=new Set(trips.map(t=>vehicle(t,vehicles)).filter(Boolean));if(known.size>1)throw new Error('Journeys from different vehicles cannot be merged.');
  for(let i=1;i<trips.length;i++){
   const stop=makeStop(trips[i-1],trips[i],{owner,metadata:meta,places,vehicles,telemetry:[]});
   if(!stop||stop.durationSeconds>86400)throw new Error('These routes overlap, are disconnected or are more than a day apart.');
   const key=edge(trips[i-1].id,trips[i].id);next.links=[...new Set([...next.links,key])];next.cuts=next.cuts.filter(k=>k!==key);
  }
 }else if(action.type==='split'){
  const a=ordered.find(t=>t.id===action.after),b=ordered.find(t=>t.id===action.before);
  if(!a||!b)throw new Error('Segment not found.');const key=edge(a.id,b.id);next.cuts=[...new Set([...next.cuts,key])];next.links=next.links.filter(k=>k!==key);
 }else if(action.type==='rename'){
  if(!ordered.some(t=>t.id===action.anchor)||!action.title?.trim()||action.title.length>150)throw new Error('Enter a journey name (up to 150 characters).');next.titles[action.anchor]=action.title.trim();
 }else if(action.type==='stop'){
  if(!action.id||!action.name?.trim()||action.name.length>100||action.tags?.some(t=>t.length>60))throw new Error('Enter a stop name and short tags.');next.stopEdits[action.id]={name:action.name.trim(),tags:(action.tags||[]).slice(0,20),replaceTags:action.replaceTags===true,ignored:action.ignored===true};
 }else throw new Error('Unsupported grouping change.');
 next.history=[...next.history,snapshot].slice(-20);return next;
}
