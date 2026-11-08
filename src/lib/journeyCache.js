// Selective journey records only. Pending writes and unfinished work are never a
// cache: they are pinned until their cloud transaction has been confirmed.
import {emptyGrouping} from './journeyGrouping.js';
import {applyChanges,edgePair,gapRefs,stopRefs} from './journeyMetadata.js';
export const JOURNEY_CACHE_ACTIVITIES=200,JOURNEY_CACHE_BYTES=16*1024*1024,JOURNEY_CACHE_DAYS=30;
const maps=['titles','types','manualTags','hiddenTags','enriched','distanceSummaries'];
export const scopeKey=refs=>JSON.stringify([...new Set(refs)].sort());
export function emptyJourneyCache(){return {scopes:{},work:{},pages:{},active:[],migrationRequired:false};}
export function recordActivityRefs(changes){
 const ids=new Set();
 for(const domain of ['activities','summaries'])for(const item of changes?.[domain]||[])ids.add(item.ref);
 for(const item of changes?.roads||[]){const id=gapRefs(item.ref);if(id)ids.add(id);}
 for(const item of changes?.pairs||[]){ids.add(item.left);ids.add(item.right);}
 for(const item of changes?.stops||[]){const ref=stopRefs(item.ref);for(const id of [ref.after,ref.before,ref.segment])if(id)ids.add(id);}
 return [...ids];
}
function belongsStop(key,refs){const ref=stopRefs(key);return [ref.after,ref.before,ref.segment].some(id=>refs.has(id));}
export function omitScope(metadata,refs,{details=false}={}){
 const ids=new Set(refs),next={...metadata};
 for(const field of maps)next[field]=Object.fromEntries(Object.entries(metadata[field]||{}).filter(([id])=>!ids.has(id)));
 for(const field of ['links','cuts'])next[field]=(metadata[field]||[]).filter(key=>!edgePair(key)?.some(id=>ids.has(id)));
 next.sourceLinks=(metadata.sourceLinks||[]).filter(pair=>!pair.some(id=>ids.has(id)));
 next.stopEdits=Object.fromEntries(Object.entries(metadata.stopEdits||{}).filter(([key])=>!belongsStop(key,ids)));
 if(details)next.roads=Object.fromEntries(Object.entries(metadata.roads||{}).filter(([key])=>!ids.has(gapRefs(key))));
 return next;
}
export function mergeScope(state,snapshot,requested,details,now=Date.now()){
 if(state.cache?.migrationRequired)throw new Error('Legacy journey metadata must finish cloud verification before cached history can be replaced. Existing data was preserved.');
 const ids=snapshot.scope,base=omitScope(state.metadata||emptyGrouping(snapshot.metadata.owner),ids);
 const metadata={...base,roads:Object.fromEntries(Object.entries(base.roads||{}).filter(([ref])=>!details.includes(gapRefs(ref))))};
 for(const field of maps)metadata[field]={...base[field],...snapshot.metadata[field]};
 for(const field of ['links','cuts'])metadata[field]=[...new Set([...base[field],...snapshot.metadata[field]])];
 metadata.sourceLinks=[...new Map([...base.sourceLinks,...snapshot.metadata.sourceLinks].map(pair=>[JSON.stringify(pair),pair])).values()];
 for(const field of ['stopEdits','places','roads'])metadata[field]={...metadata[field],...snapshot.metadata[field]};
 for(const [id,saved] of Object.entries(state.metadata?.distanceSummaries||{}))if(!details.includes(id)&&!saved.listOnly&&metadata.distanceSummaries[id]?.listOnly&&saved.updatedAt===metadata.distanceSummaries[id].updatedAt&&saved.pointCount===metadata.distanceSummaries[id].pointCount)metadata.distanceSummaries[id]=saved;
 metadata.enrichFrom=snapshot.metadata.enrichFrom;
 const cache={...(state.cache||emptyJourneyCache()),scopes:{...state.cache?.scopes}};
 cache.scopes[scopeKey(requested)]={ids,details,places:Object.keys(snapshot.metadata.places),at:now,revision:snapshot.revision,stale:false,unavailable:snapshot.unavailableRefs||[]};
 const activityRows={...state.activityRows};
 for(const row of snapshot.activityRows||[]){const old=activityRows[row.id];activityRows[row.id]=Array.isArray(old?.route_points)&&old.revision===row.revision&&!Array.isArray(row.route_points)?old:row;}
 return {...state,metadata:applyChanges(metadata,state.queue),cache,activityRows,...(Array.isArray(snapshot.savedPlaces)?{savedPlaces:snapshot.savedPlaces}:{})};
}
export function cachedScope(state,refs,details=[],now=Date.now()){
 return Object.values(state.cache?.scopes||{}).find(scope=>!scope.stale&&now-scope.at<JOURNEY_CACHE_DAYS*86400000&&refs.every(id=>scope.ids.includes(id))&&details.every(id=>scope.details.includes(id)));
}
export function invalidateJourneyCache(state,changes){
 const affected=new Set(),places=new Set();let savedPlacesChanged=false;
 for(const item of changes){
  if(item.domain==='savedPlaces')savedPlacesChanged=true;
  else if(item.domain==='activityRows')affected.add(item.ref);
  else if(item.domain==='places')places.add(item.ref);
  else if(item.domain==='pairs'){try{const [,a,b]=JSON.parse(item.ref);affected.add(a);affected.add(b);}catch{throw new Error('Cloud relationship invalidation could not be read.');}}
  else for(const id of recordActivityRefs({[item.domain]:[{ref:item.ref}]}))affected.add(id);
 }
 const cache={...(state.cache||emptyJourneyCache()),scopes:{}};
 for(const [key,scope] of Object.entries(state.cache?.scopes||{}))cache.scopes[key]={...scope,stale:scope.stale||savedPlacesChanged||scope.ids.some(id=>affected.has(id))||scope.places.some(ref=>places.has(ref))};
 return {...state,cache};
}
export function trimJourneyCache(state,{maxActivities=JOURNEY_CACHE_ACTIVITIES,maxBytes=JOURNEY_CACHE_BYTES,now=Date.now()}={}){
 if(!state.metadata||!state.status?.migratedAt||state.cache?.migrationRequired)return state;
 const cache=state.cache||emptyJourneyCache(),pinned=new Set([...cache.active,...recordActivityRefs(state.queue),...Object.entries(cache.work).filter(([,job])=>job.state!=='done').map(([id])=>id)]);
 const scopes=Object.entries(cache.scopes).sort(([,a],[,b])=>b.at-a.at),kept={};let ids=new Set(pinned);
 for(const [key,scope] of scopes){
  const union=new Set([...ids,...scope.ids]);
  if(scope.ids.some(id=>pinned.has(id))||(now-scope.at<JOURNEY_CACHE_DAYS*86400000&&union.size<=maxActivities)){kept[key]=scope;ids=union;}
 }
 const lightPins=new Set();
 for(const step of state.metadata.history||[])for(const [field,keys] of Object.entries(step._touched||{})){
  for(const key of keys)if(['links','cuts','sourceLinks'].includes(field)){try{for(const id of JSON.parse(key))lightPins.add(id);}catch{/* Unreadable history is kept, not applied. */}}
  else if(field==='stopEdits'){const ref=stopRefs(key);for(const id of [ref.after,ref.before,ref.segment])if(id)lightPins.add(id);}
  else lightPins.add(key);
 }
 const project=()=>{
  const m=state.metadata,next={...m},lightIDs=new Set([...ids,...lightPins]);
  for(const field of maps)next[field]=Object.fromEntries(Object.entries(m[field]||{}).filter(([ref])=>(field==='distanceSummaries'||field==='enriched'?ids:lightIDs).has(ref)));
  for(const field of ['links','cuts'])next[field]=(m[field]||[]).filter(key=>edgePair(key)?.some(id=>lightIDs.has(id)));
  next.sourceLinks=(m.sourceLinks||[]).filter(pair=>pair.some(id=>lightIDs.has(id)));
  next.stopEdits=Object.fromEntries(Object.entries(m.stopEdits||{}).filter(([ref])=>belongsStop(ref,lightIDs)));
  next.roads=Object.fromEntries(Object.entries(m.roads||{}).filter(([ref])=>ids.has(gapRefs(ref))));
  const placeRefs=new Set([...Object.values(cache.work).some(job=>job.state!=='done')?Object.keys(m.places||{}):[],...Object.values(kept).flatMap(s=>s.places),...(state.queue?.places||[]).map(item=>item.ref)]);
  next.places=Object.fromEntries(Object.entries(m.places||{}).filter(([ref])=>placeRefs.has(ref)));
  return applyChanges(next,state.queue);
 };
 let metadata=project();
 // Evict complete synced scopes, not arbitrary records inside a journey.
 for(const [key,scope] of [...scopes].reverse()){
  if(JSON.stringify(metadata).length+JSON.stringify(Object.fromEntries(Object.entries(state.activityRows||{}).filter(([id])=>ids.has(id)))).length<=maxBytes)break;
  if(!kept[key]||scope.ids.some(id=>pinned.has(id)))continue;
  delete kept[key];ids=new Set([...pinned,...Object.values(kept).flatMap(s=>s.ids)]);metadata=project();
 }
 const activityRows=Object.fromEntries(Object.entries(state.activityRows||{}).filter(([id])=>ids.has(id)));
 const pages=Object.fromEntries(Object.entries(cache.pages||{}).filter(([,page])=>page.ids.every(id=>activityRows[id])));
 return {...state,metadata,activityRows,cache:{...cache,scopes:kept,pages}};
}
