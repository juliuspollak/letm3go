// One sync engine for durable pending writes and selective journey context.
// Supabase owns confirmed history; encrypted SQLite/IndexedDB retain active scopes,
// offline decisions and enrichment work. Preferences are a legacy import source.
import {cachedScope,emptyJourneyCache,invalidateJourneyCache,mergeScope,recordActivityRefs,trimJourneyCache} from './journeyCache.js';
import {journeyDurableStorage} from './journeyDurableStorage.js';
import {emptyGrouping,parseGrouping,validateGrouping} from './journeyGrouping.js';
import {assertLosslessGrouping,applyChanges,changesEmpty,clearPushed,groupingChanges,rebaseChanges,mergeChanges,missingRecords,migrationChanges,recordCounts} from './journeyMetadata.js';
export const QUEUE_VERSION=1;
export const SNAPSHOT_FUNCTION='journey_metadata_snapshot';
export const APPLY_FUNCTION='journey_apply_changes';
export const REVISION_FUNCTION='journey_metadata_revision';
const DOMAINS=['activities','stops','pairs','places','roads','summaries'];
const STATES=['','active','offline','incomplete','recoveryRequired'];
const message=error=>error instanceof Error&&error.message?error.message:'Journey information could not be saved yet.';
const counts=value=>{
 const found={};
 for(const [name,count] of Object.entries(value&&typeof value==='object'?value:{}))if(Number(count)>0)found[name]=Number(count);
 return found;
};
const recordTotal=metadata=>Object.values(recordCounts(metadata)).reduce((sum,value)=>sum+(Number(value)||0),0);
// Legacy preferences are imported once. Unknown/corrupt queues block migration;
// they are not silently treated as an empty backlog.
export function readQueue(serialized,owner){
 const empty={version:QUEUE_VERSION,owner,changes:{},dropped:{}};
 if(!serialized)return empty;
 try{
  const value=JSON.parse(serialized);
  if(!value||typeof value!=='object'||value.version!==QUEUE_VERSION||value.owner!==owner)return {...empty,error:'Pending journey writes have an unsupported format or owner. Existing preferences were preserved.'};
  if(!value.changes||typeof value.changes!=='object'||Array.isArray(value.changes)||Object.keys(value.changes).some(key=>key!=='enrichFrom'&&!DOMAINS.includes(key))||DOMAINS.some(key=>value.changes[key]!==undefined&&(!Array.isArray(value.changes[key])||value.changes[key].some(item=>!item||typeof item!=='object'||(key==='pairs'?typeof item.left!=='string'||typeof item.right!=='string':typeof item.ref!=='string')))))throw new Error('Invalid pending writes');
  return {version:QUEUE_VERSION,owner,changes:mergeChanges({},value.changes),dropped:counts(value.dropped)};
 }catch{return {...empty,error:'Pending journey writes could not be read. Existing preferences were preserved.'};}
}
export function encodeQueue(changes,owner,dropped={}){
 const clean=mergeChanges({},changes);
 if(changesEmpty(clean))return '';
 const lost=counts(dropped);
 return JSON.stringify({version:QUEUE_VERSION,owner,changes:clean,...(Object.keys(lost).length?{dropped:lost}:{})});
}
export function emptyStatus(owner){return {owner,revision:null,migratedAt:null,state:'',error:null,conflicts:null,updatedAt:null};}
export function readStatus(preferences,owner){
 const stored=preferences?.journeyMetadata;
 if(!stored||typeof stored!=='object'||stored.owner!==owner)return emptyStatus(owner);
 return {owner,revision:Number.isInteger(stored.revision)?stored.revision:null,
  migratedAt:Number.isFinite(stored.migratedAt)?stored.migratedAt:null,
  state:STATES.includes(stored.state)?stored.state:'',
  error:typeof stored.error==='string'&&stored.error?stored.error:null,
  conflicts:stored.conflicts&&typeof stored.conflicts==='object'?stored.conflicts:null,
  updatedAt:Number.isFinite(stored.updatedAt)?stored.updatedAt:null};
}
// The mirror as the app already reads it, plus whether the stored text was usable.
// Unreadable text is reported, never silently replaced: it may be the only copy.
export function localMetadata(serialized,owner){
 if(!serialized)return {metadata:emptyGrouping(owner),state:'empty'};
 const metadata=parseGrouping(serialized,owner);
 return metadata?{metadata,state:'ready'}:{metadata:null,state:'unreadable'};
}

// Legacy preference keys, retained for safe import and older installation recovery.
export const MIRROR_KEY='journeyGrouping',QUEUE_KEY='journeyMetadataQueue',STATUS_KEY='journeyMetadata';
export function readJourneyState(preferences,owner){
 const mirror=localMetadata(preferences?.[MIRROR_KEY],owner),queue=readQueue(preferences?.[QUEUE_KEY],owner);
 return {storageError:queue.error,metadata:mirror.metadata,queue:queue.changes,dropped:queue.dropped,status:readStatus(preferences,owner)};
}
// Rows have independent keys: no ever-growing preferences blob, file-size eviction,
// or partial mirror/queue commit. Both adapters provide an atomic transaction.
const MIRROR_LISTS=['links','cuts','sourceLinks','history'];
const MIRROR_MAPS=['titles','types','manualTags','hiddenTags','enriched','stopEdits','places','roads','distanceSummaries'];
export function journeyRows(state){
 const rows={control:{format:2,status:state.status,dropped:state.dropped,readable:state.metadata!==null,enrichFrom:state.metadata?.enrichFrom??null,cache:state.cache?{active:state.cache.active,migrationRequired:state.cache.migrationRequired}:null}};
 // Keep raw legacy values on disk too. Conversion/validation must never erase the
 // only copy of a record a future build might need to recover.
 if(state.metadata)for(const field of [...MIRROR_MAPS,...MIRROR_LISTS]){
  for(const [ref,value] of Object.entries(state.metadata[field]||{}))rows[JSON.stringify(['mirror',field,ref])]=value;
 }
 for(const domain of DOMAINS)for(const item of state.queue?.[domain]||[])
  rows[JSON.stringify(['queue',domain,domain==='pairs'?[item.relation,...[item.left,item.right].sort()]:item.ref])]=item;
 for(const place of state.savedPlaces||[])rows[JSON.stringify(['savedPlace',place.id])]=place;
 for(const [ref,value] of Object.entries(state.activityRows||{}))rows[JSON.stringify(['activityRows',ref])]=value;
 for(const kind of ['scopes','work','pages'])for(const [ref,value] of Object.entries(state.cache?.[kind]||{}))rows[JSON.stringify([kind,ref])]=value;
 if(Number.isFinite(state.queue?.enrichFrom))rows.queueEnrichFrom=state.queue.enrichFrom;
 return rows;
}
export function stateFromJourneyRows(rows,owner){
 if(rows.control?.format!==2||rows.control.status?.owner!==owner)throw new Error('Journey storage is incomplete or belongs to another account. Existing records were preserved.');
 const metadata=rows.control.readable?emptyGrouping(owner):null,queue={},activityRows={},savedPlaces=[],cache={...emptyJourneyCache(),...rows.control.cache};
 for(const [key,value] of Object.entries(rows)){
  if(!key.startsWith('['))continue;
  const [scope,domain,ref]=JSON.parse(key);
  if(scope==='savedPlace'){savedPlaces.push(value);continue;}
  if(scope==='activityRows'){activityRows[domain]=value;continue;}
  if(['scopes','work','pages'].includes(scope)){cache[scope][domain]=value;continue;}
  if(scope==='mirror'&&metadata&&[...MIRROR_MAPS,...MIRROR_LISTS].includes(domain))metadata[domain][ref]=value;
  else if(scope==='queue'&&DOMAINS.includes(domain))(queue[domain]??=[]).push(value);
  else throw new Error('Unrecognized journey record. Existing records were preserved.');
 }
 if(Number.isFinite(rows.queueEnrichFrom))queue.enrichFrom=rows.queueEnrichFrom;
 if(metadata)metadata.enrichFrom=rows.control.enrichFrom;
 if(!rows.control.cache){cache.migrationRequired=!rows.control.status?.migratedAt&&recordTotal(metadata)>0;for(const [ref,at] of Object.entries(metadata?.enriched||{}))cache.work[ref]={state:'done',at};}
 return {metadata,queue,status:rows.control.status,dropped:rows.control.dropped||{},cache,activityRows,savedPlaces};
}
export function createJourneySync({owner,preferences=null,savePreferences,storage=journeyDurableStorage(owner)}){
 let state=readJourneyState(preferences,owner),rows={},tail=Promise.resolve(),lastWrite=null,started=false,version=0;
 let requested={refs:[],details:[]};
 const listeners=new Set(),notify=()=>{version++;for(const listener of listeners)listener();};
 let ready,legacyCleared=false;
 const cleanupLegacy=async()=>{if(!legacyCleared&&state.status?.migratedAt&&!state.cache?.migrationRequired&&changesEmpty(state.queue)){await savePreferences({journeyGrouping:null,journeyMetadataQueue:null,journeyMetadata:null});legacyCleared=true;}};
 const initialize=async()=>{
  started=true;
  const stored=await storage.read();
  if(Object.keys(stored).length){state=stateFromJourneyRows(stored,owner);rows=stored;}
  else {if(state.storageError)throw new Error(state.storageError);const initial=journeyRows(state);await storage.commit(Object.entries(initial).map(([key,value])=>({key,value})));rows=initial;}
  if(!state.cache){const cache=emptyJourneyCache();cache.migrationRequired=!state.status?.migratedAt&&(recordTotal(state.metadata)>0||!changesEmpty(state.queue));for(const [ref,at] of Object.entries(state.metadata?.enriched||{}))cache.work[ref]={state:'done',at};state={...state,cache};}
  notify();
  // Only clear legacy preferences after the complete transaction is durable. A
  // failure here leaves the old file intact and can be retried without reimporting.
  await cleanupLegacy();
  return state;
 };
 const ensureReady=()=>ready??=(Promise.resolve().then(initialize).catch(error=>{
  state={...state,status:{...state.status,state:'offline',error:message(error)}};notify();ready=null;throw error;
 }));
 return {
  read:()=>state,
  getSnapshot:()=>version,
  subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
  ready:ensureReady,
  scope:()=>requested,
  configureScope(refs,details=[]){requested={refs:[...new Set(refs)],details:[...new Set(details)]};},
  write(patch){
   const operation=async()=>{
    await ensureReady();
    const next={...state,...(typeof patch==='function'?patch(state):patch)},wanted=journeyRows(next),operations=[];
    for(const [key,value] of Object.entries(wanted))if(rows[key]!==value&&JSON.stringify(rows[key])!==JSON.stringify(value))operations.push({key,value});
    for(const key of Object.keys(rows))if(!Object.hasOwn(wanted,key))operations.push({key,remove:true});
    await storage.commit(operations);
    rows=wanted;state=next;notify();await cleanupLegacy();return state;
   };
   const result=tail.then(operation,operation);tail=result.catch(()=>{});lastWrite=result;return result;
  },
  reseed(next){if(!started)state=readJourneyState(next,owner);return state;},
  async flush(){await ensureReady();await lastWrite;return state;}
 };
}

// The legacy blob, still readable from the settings backup so an upgrade on a new
// device can seed the records instead of asking the user to start over.
export async function readLegacyBlob(client,owner){
 if(!client?.from||!owner)return null;
 const {data,error}=await client.from('account_settings').select('payload').eq('owner_id',owner).maybeSingle();
 if(error)throw new Error('Legacy journey backup could not be checked. Migration will retry without replacing local data.');
 if(!data?.payload||typeof data.payload!=='object')return null;
 const value=data.payload.journeyGrouping;
 return typeof value==='string'&&value?value:null;
}
export async function loadSnapshot(client,owner){
 if(!client?.rpc)throw new Error('Cloud sync is not available on this device.');
 const {data,error}=await client.rpc(SNAPSHOT_FUNCTION,{p_owner:owner});
 if(error)throw new Error(error.message);
 const {revision,updatedAt,...rest}=data&&typeof data==='object'?data:{};
 const metadata=validateGrouping(rest,owner);
 if(!metadata)throw new Error('Stored journey information could not be read.');
 const parsed=typeof updatedAt==='string'?Date.parse(updatedAt):updatedAt;
 return {metadata,revision:Number.isInteger(revision)?revision:null,updatedAt:Number.isFinite(parsed)?parsed:null};
}
export async function loadRevision(client,owner){
 if(!client?.rpc)throw new Error('Cloud sync is not available on this device.');
 const {data,error}=await client.rpc(REVISION_FUNCTION,{p_owner:owner});
 if(error)throw new Error(error.message);
 return Number.isInteger(data)?data:null;
}
// One round trip per batch. The expected revision makes a concurrent edit on another
// device a visible conflict instead of a silent overwrite; the caller retries once
// with the newer revision because the payload is values, not deltas. The answer also
// lists the records whose stored value this write replaced with a different one, so a
// device that loses a same-record race is told about it instead of finding out later.
export async function pushChanges(client,owner,changes,expectedRevision){
 const clean=mergeChanges({},changes);
 if(changesEmpty(clean))return {revision:expectedRevision??null,overwritten:[]};
 if(!client?.rpc)throw new Error('Cloud sync is not available on this device.');
 const {data,error}=await client.rpc(APPLY_FUNCTION,{p_owner:owner,p_changes:clean,p_expected_revision:expectedRevision??null});
 if(error)throw new Error(error.message);
 // A deployment that has not yet had the reporting version applied answers with the
 // revision alone; that is a save, just a quieter one.
 if(Number.isInteger(data))return {revision:data,overwritten:[]};
 const revision=data?.revision;
 if(!Number.isInteger(revision))throw new Error('Journey information was not saved.');
 return {revision,overwritten:Array.isArray(data.overwritten)?data.overwritten:[]};
}
// Requests are bounded so a long backlog cannot exceed the gateway body limit.
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
 let next=revision??null;const overwritten=[];
 for(const chunk of chunkChanges(changes)){
  const result=await pushChanges(client,owner,chunk,next);
  next=result.revision;
  for(const item of result.overwritten)overwritten.push(item);
 }
 return {revision:next,overwritten};
}

function conflictSummary(conflicts){
 const total=Object.entries(conflicts||{}).reduce((sum,[name,count])=>sum+(name==='total'?0:(Number(count)||0)),0);
 return total>0?{...conflicts,total}:null;
}
// A same-record race is reported as a count per domain, which is what the device
// status can carry; `total` is the number the screen shows.
export function overwrittenSummary(overwritten){
 const counts={};
 for(const item of Array.isArray(overwritten)?overwritten:[]){
  const domain=DOMAINS.includes(item?.domain)?item.domain:'other';
  counts[domain]=(counts[domain]||0)+1;
 }
 return conflictSummary(counts);
}
// Brings the cloud up to date with what this device already knows. Nothing local is
// replaced until the cloud copy has been read back and matches what was sent, so an
// interrupted migration simply runs again: the mirror is untouched, `migratedAt` is
// not stamped, and everything the cloud already has is skipped the second time.
export async function migrateJourneyMetadata({client,owner,read,write,now=Date.now}){
 const state=read(),local=state.metadata,queued=state.queue??{};
 assertLosslessGrouping(local);
 const snapshot=await loadSnapshot(client,owner);
 const stored=recordTotal(snapshot.metadata),readable=local!==null;
 // What this device knows is its own mirror plus the values still queued behind it.
 let source=readable?applyChanges(local,queued):null;
 // A phone that has never synced, or whose own file could not be read, may still have
 // the journeys an older build wrote into the settings backup. It is read once, and
 // only while the account has no records at all: someone upgrading from an old build
 // long after everyone else has moved on still finds their journeys.
 if(recordTotal(source)===0&&stored===0){
  const legacy=await readLegacyBlob(client,owner);
  const recovered=legacy?parseGrouping(legacy,owner):null;
  if(legacy&&!recovered)throw new Error('Legacy cloud journey information could not be read. The original backup was preserved.');
  assertLosslessGrouping(recovered);
  if(recordTotal(recovered)>0)source=applyChanges(recovered,queued);
 }
 if(recordTotal(source)===0){
  if(!readable&&stored===0){
   const error='Saved journey information on this device could not be read and no cloud copy was found. Nothing has been replaced.';
   await write({status:{...read().status,state:'recoveryRequired',error}});
   return {state:'recoveryRequired',error};
  }
  // Nothing to upload: an empty account, or a device adopting the cloud copy.
  source=emptyGrouping(owner);
 }
 const {changes,conflicts}=migrationChanges(source,snapshot.metadata);
 // A queued value is this device's newest answer and goes on top of what the cloud
 // already has, so an edit made between the upgrade and this first run is not dropped
 // when the local mirror is replaced.
 if(Object.values(conflicts).some(Boolean)){
  const error='Legacy journey records differ from cloud records. Both copies are preserved; resolve the differences before migration.';
  await write({status:{...read().status,state:'incomplete',error,conflicts:conflictSummary(conflicts)}});
  return {state:'incomplete',error};
 }
 const acceptedQueued={...queued};
 // The account cutoff is immutable; a fresh device's provisional cutoff must
 // not prevent it from adopting the existing account history.
 if(Number.isFinite(snapshot.metadata.enrichFrom))delete acceptedQueued.enrichFrom;
 const rebased=stored?rebaseChanges(acceptedQueued,snapshot.metadata):{changes:acceptedQueued,conflicts:[]};
 if(rebased.conflicts.length)throw new Error('Conflicting pending journey fields. Local and cloud values are preserved.');
 const wanted=mergeChanges(changes,rebased.changes);
 const pushed=await pushAll(client,owner,wanted,snapshot.revision);
 const verified=await loadSnapshot(client,owner);
 const missing=missingRecords(applyChanges(snapshot.metadata,wanted),verified.metadata);
 if(missing.length){
  const error=`${missing.length} saved ${missing.length===1?'detail was':'details were'} not stored in the cloud. Nothing on this device has been replaced.`;
  await write({status:{...read().status,revision:pushed.revision,state:'incomplete',error}});
  return {state:'incomplete',error,missing:missing.length};
 }
 const reported=conflictSummary(conflicts)??overwrittenSummary(pushed.overwritten);
 await write(latest=>{
  const remaining=clearPushed(latest.queue,queued);
  const effective=applyChanges({...verified.metadata,history:latest.metadata?.history||source.history},remaining);
  const cache=latest.cache?{...latest.cache,migrationRequired:false,work:{...latest.cache.work,...Object.fromEntries(Object.entries(effective.enriched||{}).map(([id,at])=>[id,{state:'done',at}]))}}:undefined;
  return {metadata:effective,queue:remaining,dropped:{},...(cache?{cache}:{}),
   status:{owner,revision:verified.revision??pushed.revision,cursorRevision:verified.revision??pushed.revision,migratedAt:now(),state:'active',error:null,conflicts:reported,updatedAt:verified.updatedAt??null}};
 });
 return {state:'active',conflicts:reported};
}
// The steady state: read first, so an edit made on another device while this one was
// away becomes a pull instead of a conflict; then send what is queued.
async function pullJourneyMetadata({client,owner,write},revision){
 const snapshot=await loadSnapshot(client,owner);
 await write(latest=>{
  const rebased=rebaseChanges(latest.queue,snapshot.metadata);
  if(rebased.conflicts.length)throw new Error(`Conflicting journey fields on another device: ${rebased.conflicts.map(item=>`${item.ref}.${item.field}`).join(', ')}. Both versions are preserved: the pending edit on this device and the cloud value. Resolve before syncing.`);
  const merged=applyChanges({...snapshot.metadata,history:latest.metadata?.history||[]},rebased.changes);
  return {metadata:merged,queue:rebased.changes,
   status:{...latest.status,revision:snapshot.revision??revision,state:'active',error:null,updatedAt:snapshot.updatedAt??null}};
 });
 return snapshot.revision??revision;
}
export async function flushJourneyMetadata({client,owner,read,write,scope,now=Date.now}){
 if(scope)return flushScopedJourneyMetadata({client,owner,read,write,scope,now});
 const status=read().status??emptyStatus(owner);
 let revision=status.revision,conflicts=null;
 // One cheap call decides whether anything changed at all, so an idle device does not
 // download the whole grouping every two minutes.
 const remote=await loadRevision(client,owner);
 // The cloud copy is gone (a restored project, a cleared account): upload what this
 // device knows again instead of pulling an empty grouping over the mirror.
 if(remote===null&&revision!==null)return migrateJourneyMetadata({client,owner,read,write,now});
 if(remote!==null&&remote!==revision)revision=await pullJourneyMetadata({client,owner,read,write},remote);
 const pending=read().queue;
 if(!changesEmpty(pending)){
  assertLosslessGrouping(read().metadata);
  let sent=read().queue;
  try{
   const pushed=await pushAll(client,owner,sent,revision);
   revision=pushed.revision;
  }catch(error){
   // Both devices wrote between the read and the write. Keep the remote records and
   // send the queued values on top of them once, because a record is a value.
   const latest=await loadRevision(client,owner);
   if(latest===null||!/conflict/i.test(message(error)))throw error;
   revision=await pullJourneyMetadata({client,owner,read,write},latest);
   sent=read().queue;
   const pushed=await pushAll(client,owner,sent,revision);
   revision=pushed.revision;
  }
  await write(latest=>({queue:clearPushed(latest.queue,sent),
   status:{...latest.status,revision,state:'active',error:null,...(conflicts?{conflicts}:{})}}));
 }
 return {state:'active',revision};
}
const runningSyncs=new WeakMap();
export function runJourneySync(context){
 const existing=runningSyncs.get(context.read);if(existing)return existing;
 const task=runJourneySyncOnce(context).finally(()=>{if(runningSyncs.get(context.read)===task)runningSyncs.delete(context.read);});
 runningSyncs.set(context.read,task);return task;
}
async function runJourneySyncOnce({client,owner,read,write,ready,scope,now=Date.now}){
 if(ready)await ready();
 if(!client||!owner)return {state:'idle'};
 const status=read().status??emptyStatus(owner);
 try{
  // A device whose own copy cannot be read is not abandoned: another device may upload
  // the records later, and the migration path adopts them. Only a device with nothing
  // readable anywhere stays in recoveryRequired, and it never replaces its own copy.
  if(read().cache?.migrationRequired)return await migrateJourneyMetadata({client,owner,read,write,now});
  if(scope&&!read().cache?.migrationRequired)return await flushJourneyMetadata({client,owner,read,write,scope,now});
  if(status.migratedAt)return await flushJourneyMetadata({client,owner,read,write,scope,now});
  return await migrateJourneyMetadata({client,owner,read,write,now});
 }catch(error){
  const failure=message(error);
  await write({status:{...read().status,state:'offline',error:failure}});
  return {state:'offline',error:failure};
 }
}

// The runtime snapshot overload returns one requested relationship context, never
// the account history. The original RPC shape is retained only for legacy import.
export async function loadJourneyScope(client,owner,refs,details=[],placeRefs=[],request={}){
 const {data,error}=await client.rpc(SNAPSHOT_FUNCTION,{p_owner:owner,p_refs:refs,p_detail_refs:details,p_place_refs:placeRefs,p_geometry:details.length>0,...request});
 if(error)throw new Error(error.message);
 const {unavailableRefs=[],savedPlaces,activityRows=[],pageRefs,nextActivity,recordsExist,scope,details:loadedDetails,invalidations:_i,next:_n,atRevision:_a,complete,revision,updatedAt,...raw}=data||{};
 void _i;void _n;void _a;
 const metadata=validateGrouping(raw,owner);
 if(!metadata||!Array.isArray(scope)||complete!==true)throw new Error('Saved journey context is unavailable or incomplete.');
 return {metadata,scope,details:loadedDetails||[],revision,updatedAt,activityRows,pageRefs,nextActivity,recordsExist,savedPlaces,unavailableRefs};
}
function scopedChanges(changes,refs){
 const ids=new Set(refs),subset={};
 for(const name of DOMAINS){
  const items=(changes?.[name]||[]).filter(item=>recordActivityRefs({[name]:[item]}).some(id=>ids.has(id)));
  if(items.length)subset[name]=items;
 }
 return subset;
}
export function rebaseJourneyScope(state,fetched,refs,details=[]){
 const subset=scopedChanges(state.queue,fetched.scope),rebased=rebaseChanges(subset,fetched.metadata);
 if(rebased.conflicts.length)throw new Error(`Conflicting journey fields on another device: ${rebased.conflicts.map(item=>`${item.ref}.${item.field}`).join(', ')}. Both local and cloud versions are preserved.`);
 const queue=mergeChanges(clearPushed(state.queue,subset),rebased.changes);
 return mergeScope({...state,queue},fetched,refs,details);
}
// Do not pass an unverified legacy mirror into cache replacement. The same
// serialized sync engine verifies it first; genuine conflicts keep both copies.
export async function ensureJourneyCacheReady(context){
 if(!context.read().cache?.migrationRequired)return;
 const result=await runJourneySync(context);
 if(context.read().cache?.migrationRequired||!['active','idle'].includes(result.state))throw new Error(result.error||'Saved journey details need verification. Existing data is safe.');
}
export async function ensureJourneyScope({client,owner,read,write},refs,details=[],{force=false}={}){
 await ensureJourneyCacheReady({client,owner,read,write});
 if(!force&&cachedScope(read(),refs,details))return;
 const fetched=await loadJourneyScope(client,owner,refs,details);
 await write(latest=>rebaseJourneyScope(latest,fetched,refs,details));
 return fetched;
}
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
async function flushScopedJourneyMetadata(context){
 const {client,owner,read,write,scope,now}=context;
 const requested=scope();
 let head=await loadRevision(client,owner);
 if(!read().status.migratedAt){
  const control=await loadJourneyScope(client,owner,[],[]);
  if(!control.recordsExist){
   const legacy=await readLegacyBlob(client,owner);
   if(legacy){const metadata=parseGrouping(legacy,owner);if(!metadata)throw new Error('Legacy cloud journey data could not be read.');await write(latest=>({metadata:applyChanges(metadata,latest.queue),cache:{...latest.cache,migrationRequired:true}}));return migrateJourneyMetadata(context);}
  }
  await write(latest=>({savedPlaces:control.savedPlaces||latest.savedPlaces,metadata:{...latest.metadata,enrichFrom:control.metadata.enrichFrom??latest.metadata?.enrichFrom},queue:Number.isFinite(control.metadata.enrichFrom)?Object.fromEntries(Object.entries(latest.queue).filter(([key])=>key!=='enrichFrom')):latest.queue,status:{...latest.status,revision:head,cursorRevision:head,migratedAt:now(),state:'active',error:null}}));
 }else if(head===null&&read().status.revision!==null){
  throw new Error('Cloud journey history is unavailable. Cached data and pending work were preserved; restore the cloud project before syncing.');
 }else if(head!==(read().status.cursorRevision??read().status.revision))await readJourneyInvalidations(context,head);
 await write(latest=>({cache:{...latest.cache,active:requested.refs}}));
 // Empty scope still fetches the account cutoff once, but no roads or POI data.
 if(requested.refs.length)await ensureJourneyScope(context,requested.refs,requested.details);
 for(let attempt=0;attempt<2;attempt++){
  const pending=read().queue;
  if(changesEmpty(pending))break;
  try{
   for(const sent of chunkChanges(pending).flatMap(chunk=>recordActivityRefs({roads:chunk.roads,summaries:chunk.summaries}).length>50?chunkChanges(chunk,{maxRecords:50}):[chunk])){
    const refs=recordActivityRefs(sent);
    let revision=read().status.revision;
    if(refs.length){const fetched=await ensureJourneyScope(context,refs,[],{force:true});revision=fetched.revision;}
    const actual={};
    for(const domain of DOMAINS){const matching=(read().queue[domain]||[]).filter(item=>(sent[domain]||[]).some(old=>domain==='pairs'?old.relation===item.relation&&old.left===item.left&&old.right===item.right:old.ref===item.ref));if(matching.length)actual[domain]=matching;}
    // Derived places and the once-per-account cutoff have no activity identity.
    if(sent.places)actual.places=sent.places;
    if(Number.isFinite(sent.enrichFrom))actual.enrichFrom=sent.enrichFrom;
    const pushed=await pushAll(client,owner,actual,revision);
    // Read back this bounded context before releasing pending derived results.
    if(refs.length||actual.places?.length){
     const confirmed=await loadJourneyScope(client,owner,refs,recordActivityRefs({roads:actual.roads,summaries:actual.summaries}),(actual.places||[]).map(item=>item.ref),{p_geometry:false});
     if(!changesEmpty(groupingChanges(confirmed.metadata,applyChanges(confirmed.metadata,actual))))throw new Error('Journey upload could not be verified. Pending records were preserved.');
    }
    await write(latest=>({queue:clearPushed(latest.queue,actual),status:{...latest.status,revision:pushed.revision,state:'active',error:null}}));
   }
   break;
  }catch(error){
   if(attempt||!/conflict/i.test(message(error)))throw error;
   head=await loadRevision(client,owner);await readJourneyInvalidations(context,head);
  }
 }
 await write(latest=>trimJourneyCache({...latest,status:{...latest.status,state:'active',error:null}}));
 return {state:'active',revision:read().status.revision};
}
