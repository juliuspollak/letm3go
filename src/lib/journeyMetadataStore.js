// Supabase is the source of truth for journey metadata (titles, tags, types,
// grouping, merges, splits, stop corrections and the enrichment answers saved with
// them). This module keeps a bounded, read-only cache of it on the device, for
// speed and offline viewing, and writes every change straight to Supabase.
//
//  - Reads: the cache is refreshed from Supabase on start and on returning to the
//    app (refreshJourneyMetadata). A cached value never competes with Supabase and
//    is never uploaded.
//  - Writes: commitJourneyChanges sends the change to journey_apply_changes and
//    updates the cache only after Supabase confirms it. Offline, or on a server
//    refusal, nothing changes and the caller gets an error. Nothing is queued.
import {cachedScope,emptyJourneyCache,invalidateJourneyCache,mergeScope,recordActivityRefs,trimJourneyCache} from './journeyCache.js';
import {journeyDurableStorage} from './journeyDurableStorage.js';
import {emptyGrouping,validateGrouping} from './journeyGrouping.js';
import {applyChanges,changesEmpty,groupingChanges,mergeChanges} from './journeyMetadata.js';
export const SNAPSHOT_FUNCTION='journey_metadata_snapshot';
export const APPLY_FUNCTION='journey_apply_changes';
export const REVISION_FUNCTION='journey_metadata_revision';
export const OFFLINE_MESSAGE='Connect to the internet to save journey changes.';
const DOMAINS=['activities','stops','pairs','places','roads','summaries'];
// Stored rows from any other format (earlier builds kept a queue and a migration
// state here) are discarded: the cache is rebuilt from Supabase.
const FORMAT=3;
const LEGACY_PREFERENCES=['journeyGrouping','journeyMetadataQueue','journeyMetadata'];
const MIRROR_LISTS=['links','cuts','sourceLinks','history'];
const MIRROR_MAPS=['titles','types','manualTags','hiddenTags','enriched','stopEdits','places','roads','distanceSummaries'];
const message=error=>error instanceof Error&&error.message?error.message:'Journey information could not be saved.';
const online=()=>typeof navigator==='undefined'||navigator.onLine!==false;

export function emptyState(owner){
 return {metadata:emptyGrouping(owner),status:{owner,revision:null,cursorRevision:null},cache:emptyJourneyCache(),activityRows:{},savedPlaces:[]};
}
// Rows have independent keys, so a large cache is never rewritten as one blob.
export function journeyRows(state){
 const rows={control:{format:FORMAT,status:state.status,enrichFrom:state.metadata.enrichFrom??null,active:state.cache.active}};
 for(const field of [...MIRROR_MAPS,...MIRROR_LISTS])for(const [ref,value] of Object.entries(state.metadata[field]||{}))rows[JSON.stringify(['mirror',field,ref])]=value;
 for(const place of state.savedPlaces||[])rows[JSON.stringify(['savedPlace',place.id])]=place;
 for(const [ref,value] of Object.entries(state.activityRows||{}))rows[JSON.stringify(['activityRows',ref])]=value;
 for(const kind of ['scopes','work','pages'])for(const [ref,value] of Object.entries(state.cache?.[kind]||{}))rows[JSON.stringify([kind,ref])]=value;
 return rows;
}
// null when the stored rows are not this format or belong to another account.
export function stateFromJourneyRows(rows,owner){
 if(rows.control?.format!==FORMAT||rows.control.status?.owner!==owner)return null;
 const state=emptyState(owner);
 state.status=rows.control.status;state.cache.active=rows.control.active||[];state.metadata.enrichFrom=rows.control.enrichFrom;
 for(const [key,value] of Object.entries(rows)){
  if(!key.startsWith('['))continue;
  const [scope,domain,ref]=JSON.parse(key);
  if(scope==='savedPlace')state.savedPlaces.push(value);
  else if(scope==='activityRows')state.activityRows[domain]=value;
  else if(['scopes','work','pages'].includes(scope))state.cache[scope][domain]=value;
  else if(scope==='mirror'&&[...MIRROR_MAPS,...MIRROR_LISTS].includes(domain))state.metadata[domain][ref]=value;
 }
 return state;
}

export function createJourneySync({owner,preferences=null,savePreferences=null,storage=journeyDurableStorage(owner)}){
 let state=emptyState(owner),rows={},tail=Promise.resolve(),lastWrite=null,version=0,ready;
 let requested={refs:[],details:[]};
 const listeners=new Set(),notify=()=>{version++;for(const listener of listeners)listener();};
 const initialize=async()=>{
  const stored=await storage.read(),loaded=stateFromJourneyRows(stored,owner);
  state=loaded??emptyState(owner);rows=stored;
  if(!loaded){
   const wanted=journeyRows(state);
   await storage.commit([...Object.entries(wanted).map(([key,value])=>({key,value})),...Object.keys(stored).filter(key=>!Object.hasOwn(wanted,key)).map(key=>({key,remove:true}))]);
   rows=wanted;
  }
  notify();
  // Earlier builds mirrored this metadata in the preferences file. It is not used.
  if(savePreferences&&LEGACY_PREFERENCES.some(key=>preferences?.[key]!=null))await savePreferences(Object.fromEntries(LEGACY_PREFERENCES.map(key=>[key,null]))).catch(()=>{});
  return state;
 };
 const ensureReady=()=>ready??=Promise.resolve().then(initialize).catch(error=>{ready=null;throw error;});
 return {
  read:()=>state,
  getSnapshot:()=>version,
  subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
  ready:ensureReady,
  scope:()=>requested,
  configureScope(refs,details=[]){requested={refs:[...new Set(refs)],details:[...new Set(details)]};},
  // Changes the local cache only. Journey metadata reaches it through
  // refreshJourneyMetadata or commitJourneyChanges, never from the UI directly.
  write(patch){
   const operation=async()=>{
    await ensureReady();
    const next={...state,...(typeof patch==='function'?patch(state):patch)},wanted=journeyRows(next),operations=[];
    for(const [key,value] of Object.entries(wanted))if(rows[key]!==value&&JSON.stringify(rows[key])!==JSON.stringify(value))operations.push({key,value});
    for(const key of Object.keys(rows))if(!Object.hasOwn(wanted,key))operations.push({key,remove:true});
    await storage.commit(operations);
    rows=wanted;state=next;notify();return state;
   };
   const result=tail.then(operation,operation);tail=result.catch(()=>{});lastWrite=result;return result;
  },
  async flush(){await ensureReady();await lastWrite;return state;}
 };
}

export async function loadRevision(client,owner){
 if(!client?.rpc)throw new Error('Cloud sync is not available on this device.');
 const {data,error}=await client.rpc(REVISION_FUNCTION,{p_owner:owner});
 if(error)throw new Error(error.message);
 // null is a real answer (the account has no journey records); anything else must be a number.
 if(data===null)return null;
 if(!Number.isInteger(data))throw new Error('The journey revision could not be read.');
 return data;
}
// The expected revision makes a write from a stale view a visible conflict instead of
// a silent overwrite.
export async function pushChanges(client,owner,changes,expectedRevision){
 const clean=mergeChanges({},changes);
 if(changesEmpty(clean))return {revision:expectedRevision??null};
 if(!client?.rpc)throw new Error('Cloud sync is not available on this device.');
 const {data,error}=await client.rpc(APPLY_FUNCTION,{p_owner:owner,p_changes:clean,p_expected_revision:expectedRevision??null});
 if(error)throw new Error(error.message);
 const revision=Number.isInteger(data)?data:data?.revision;
 if(!Number.isInteger(revision))throw new Error('Journey information was not saved.');
 return {revision};
}
// Requests are bounded so a large batch cannot exceed the gateway body limit.
export function chunkChanges(changes,{maxRecords=200,maxBytes=120000}={}){
 const chunks=[];let current={},count=0,bytes=2;
 const flush=()=>{if(!changesEmpty(current))chunks.push(current);current={};count=0;bytes=2;};
 const enrichFrom=changes?.enrichFrom;
 if(Number.isFinite(enrichFrom))current.enrichFrom=enrichFrom;
 for(const name of DOMAINS)for(const item of Array.isArray(changes?.[name])?changes[name]:[]){
  const size=new TextEncoder().encode(JSON.stringify(item)).length+1;
  if(count&&(count>=maxRecords||bytes+size>maxBytes))flush();
  current[name]=[...(current[name]||[]),item];count+=1;bytes+=size;
 }
 flush();
 return chunks;
}
export async function pushAll(client,owner,changes,revision){
 let next=revision??null;
 for(const chunk of chunkChanges(changes))next=(await pushChanges(client,owner,chunk,next)).revision;
 return {revision:next};
}

// One request returns the requested relationship context, never the account history.
export async function loadJourneyScope(client,owner,refs,details=[],placeRefs=[],request={}){
 const {data,error}=await client.rpc(SNAPSHOT_FUNCTION,{p_owner:owner,p_refs:refs,p_detail_refs:details,p_place_refs:placeRefs,p_geometry:details.length>0,...request});
 if(error)throw new Error(error.message);
 const {unavailableRefs=[],savedPlaces,activityRows=[],pageRefs,nextActivity,recordsExist,scope,details:loadedDetails,invalidations:_i,next:_n,atRevision:_a,complete,revision,updatedAt,...raw}=data||{};
 void _i;void _n;void _a;
 const metadata=validateGrouping(raw,owner);
 if(!metadata||!Array.isArray(scope)||complete!==true)throw new Error('Saved journey context is unavailable or incomplete.');
 return {metadata,scope,details:loadedDetails||[],revision,updatedAt,activityRows,pageRefs,nextActivity,recordsExist,savedPlaces,unavailableRefs};
}
// Replaces the cached records for these journeys with Supabase's.
export async function ensureJourneyScope({client,owner,read,write},refs,details=[],{force=false}={}){
 if(!force&&cachedScope(read(),refs,details))return null;
 const fetched=await loadJourneyScope(client,owner,refs,details);
 await write(latest=>mergeScope(latest,fetched,refs,details));
 return fetched;
}

// What changed in Supabase since this cache last looked: the affected cached scopes
// are marked stale and fetched again when next shown.
async function readJourneyInvalidations({client,owner,read,write},head){
 let cursor=null,at=head;
 do{
  const {data,error}=await client.rpc(SNAPSHOT_FUNCTION,{p_owner:owner,p_refs:[],p_since_revision:read().status.cursorRevision??read().status.revision??0,p_cursor:cursor,p_at_revision:at});
  if(error)throw new Error(error.message);
  if(!Array.isArray(data?.invalidations))throw new Error('Journey changes could not be read.');
  at=data.atRevision;cursor=data.next;
  await write(latest=>invalidateJourneyCache(latest,data.invalidations));
  if(data.invalidations.some(item=>item.domain==='savedPlaces')){const control=await loadJourneyScope(client,owner,[],[]);await write({savedPlaces:control.savedPlaces||[]});}
 }while(cursor);
 await write(latest=>({status:{...latest.status,cursorRevision:at,revision:at}}));
}
const running=new WeakMap();
// Brings the cache up to date with Supabase and fetches the scope now on screen.
// One run at a time per store; a failure leaves the cache as it was.
export function refreshJourneyMetadata(context){
 const existing=running.get(context.read);if(existing)return existing;
 const task=refreshOnce(context).finally(()=>{if(running.get(context.read)===task)running.delete(context.read);});
 running.set(context.read,task);return task;
}
async function refreshOnce({client,owner,read,write,ready,scope}){
 if(ready)await ready();
 if(!client||!owner||!online())return {state:'idle'};
 // An account with no journey records is revision 0: it is looked at once, not on every refresh.
 const context={client,owner,read,write},head=await loadRevision(client,owner),current=head??0,cursor=read().status.cursorRevision;
 if(cursor===null){
  const control=await loadJourneyScope(client,owner,[],[]);
  await write(latest=>({savedPlaces:control.savedPlaces||latest.savedPlaces,metadata:{...latest.metadata,enrichFrom:control.metadata.enrichFrom??latest.metadata.enrichFrom},status:{...latest.status,revision:current,cursorRevision:current}}));
 }else if(head===null&&cursor>0){
  // The account has no journey records any more (an emptied project): the cache follows.
  await write({...emptyState(owner),status:{owner,revision:0,cursorRevision:0}});
 }else if(current!==cursor)await readJourneyInvalidations(context,current);
 const wanted=scope?scope():{refs:[],details:[]};
 await write(latest=>({cache:{...latest.cache,active:wanted.refs}}));
 if(wanted.refs.length)await ensureJourneyScope(context,wanted.refs,wanted.details);
 await write(latest=>trimJourneyCache(latest));
 return {state:'active',revision:read().status.revision};
}

// Every journey metadata change goes through here. `build(base)` returns the full
// metadata that should result from `base` (already validated). The change is sent to
// Supabase and applied to the cache only once Supabase has confirmed it.
//  - Anything that carries a person's decisions (titles, tags, types, grouping, stop
//    corrections, and the done marker that shares a record with them) is rebuilt on the
//    journey's current copy in Supabase and written against its revision, so it can
//    never overwrite a newer value from another device.
//  - `derived` records that stand alone (places, road estimates, distance summaries the
//    device has just worked out) are plain values and are sent as they are.
const DECISIONS=['activities','pairs','stops'];
export async function commitJourneyChanges({client,owner,read,write,ready},build,{derived=false}={}){
 if(ready)await ready();
 if(!client||!owner||!online())throw new Error(OFFLINE_MESSAGE);
 for(let attempt=0;;attempt++){
  try{
   let base=read().metadata,next=build(base),changes=groupingChanges(base,next),revision=null;
   if(changesEmpty(changes))return {changed:false};
   if(!derived||DECISIONS.some(name=>changes[name]?.length)){
    const refs=recordActivityRefs(changes);
    if(refs.length){
     const fetched=await ensureJourneyScope({client,owner,read,write},refs,[],{force:true});
     revision=fetched.revision;
     base=read().metadata;next=build(base);changes=groupingChanges(base,next);
     if(changesEmpty(changes))return {changed:false};
    }
   }
   const pushed=await pushAll(client,owner,changes,revision);
   // Supabase has it. The cache takes the same change on top of whatever it holds now (a
   // refresh may have run meanwhile); if that cannot be stored, the next refresh catches up.
   await write(latest=>{
    const was=latest.status,current=revision!==null&&was.cursorRevision===revision;
    return {metadata:{...applyChanges(latest.metadata,changes),history:next.history},
     status:{...was,revision:pushed.revision,...(current?{cursorRevision:pushed.revision}:{})}};
   }).catch(()=>{});
   return {changed:true,revision:pushed.revision};
  }catch(error){
   const text=message(error);
   if(!derived&&attempt===0&&/conflict/i.test(text))continue;
   if(/conflict/i.test(text))throw new Error('This journey was changed on another device. Try again.',{cause:error});
   if(!online()||/fetch|network|offline|timed out|connection/i.test(text))throw new Error(OFFLINE_MESSAGE,{cause:error});
   throw new Error(derived?text:`Your change was not saved: ${text}`,{cause:error});
  }
 }
}
