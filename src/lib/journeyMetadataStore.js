// The sync engine behind journey grouping. The preferences file keeps a mirror so
// the grouping screen opens instantly and works offline; the records in Postgres are
// the record of truth. Every write is a set of record values keyed by domain and
// applied by the same reducer on both sides, so a retried, duplicated or reordered
// write converges instead of clobbering another device.
import {emptyGrouping,parseGrouping,validateGrouping} from './journeyGrouping.js';
import {applyChanges,changesEmpty,clearPushed,fitCache,fitQueue,mergeChanges,missingRecords,migrationChanges,recordCounts} from './journeyMetadata.js';
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
// The queue of records still to send. It keeps values, not operations, so replaying
// it after a restart cannot duplicate or invert anything. `dropped` is the count of
// recomputable answers this device had to give up to stay inside its own preference
// file (journeyMetadata.js, fitQueue): it is stored next to the queue so the loss is
// reported by the same save that made it, and it disappears once the queue is sent.
export function readQueue(serialized,owner){
 const empty={version:QUEUE_VERSION,owner,changes:{},dropped:{}};
 if(!serialized)return empty;
 try{
  const value=JSON.parse(serialized);
  if(!value||typeof value!=='object'||value.version!==QUEUE_VERSION||value.owner!==owner)return empty;
  return {version:QUEUE_VERSION,owner,changes:mergeChanges({},value.changes),dropped:counts(value.dropped)};
 }catch{return empty;}
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

// The device half of the sync: the mirror the grouping screen reads, the record
// values still to send, and how far the last run got. They live under three keys of
// the account preferences and are written together, so a crash cannot leave a queued
// value without the edit that produced it.
export const MIRROR_KEY='journeyGrouping',QUEUE_KEY='journeyMetadataQueue',STATUS_KEY='journeyMetadata';
export function readJourneyState(preferences,owner){
 const mirror=localMetadata(preferences?.[MIRROR_KEY],owner),queue=readQueue(preferences?.[QUEUE_KEY],owner);
 return {metadata:mirror.metadata,queue:queue.changes,dropped:queue.dropped,status:readStatus(preferences,owner)};
}
// The store writes into memory and this turns the touched keys into one preferences
// patch. Nothing else in the preferences file is rewritten, so an unrelated setting
// saved at the same moment cannot be undone by a sync pass.
export function journeyStatePatch(state,owner,keys){
 const patch={};
 // An unreadable mirror stays as it is: replacing it with nothing would destroy the
 // only copy of what the device knows, which is the one thing a sync must never do.
 if(keys.has('metadata')&&state.metadata)patch[MIRROR_KEY]=JSON.stringify(state.metadata);
 if(keys.has('queue'))patch[QUEUE_KEY]=encodeQueue(state.queue,owner,state.dropped);
 if(keys.has('status'))patch[STATUS_KEY]=state.status;
 return patch;
}
// What the sync engine reads and writes, backed by the preferences file. Reads are
// synchronous and immediate (the engine writes, then reads what it wrote), while the
// save is coalesced: one edit, one preferences write, no matter how many record
// groups it touched. The starting state is the account's own file, read once when the
// adapter is created for that account, so a restored account never inherits another's
// queue.
//
// The queue is fitted here, at the one place every edit and every sync pass goes
// through, so a device that has been offline for a week still writes a preferences
// file its own secure storage accepts: recomputable answers are given up first and
// counted, decisions are kept.
export function createJourneySync({owner,preferences=null,savePreferences}){
 const state={metadata:null,queue:{},dropped:{},status:emptyStatus(owner)};
 Object.assign(state,readJourneyState(preferences,owner));
 const dirty=new Set();
 let scheduled=null;
 const keys=()=>[...dirty];
 // One write at a time: a save already in flight is what a caller waits for, so an edit
 // and the status it produced cannot become two preferences writes.
 let inFlight=null;
 const save=()=>{
  if(inFlight)return inFlight;
  if(!dirty.size)return Promise.resolve(state);
  const sent=keys(),patch=journeyStatePatch(state,owner,new Set(sent));
  // A key stops being dirty only once the device has accepted it, so a locked or full
  // device cannot lose an edit that was made while the write was failing.
  inFlight=Promise.resolve().then(()=>savePreferences(patch))
   .then(()=>{for(const key of sent)dirty.delete(key);return state;})
   .finally(()=>{inFlight=null;});
  return inFlight;
 };
 const drain=()=>save().then(()=>dirty.size?drain():state);
 // A failed preferences write is reported through the status the next run reads, so the
 // values stay in the queue and are sent again; it is not thrown at the caller of an
 // action that already happened.
 const schedule=()=>{
  if(scheduled)return;
  scheduled=Promise.resolve().then(()=>{scheduled=null;return drain();}).catch(error=>{
   state.status={...state.status,state:'offline',error:message(error)};
  });
 };
 return {
  read(){return state;},
  write(patch){
   let changed=false;
   for(const key of ['metadata','queue','status']){
    if(!Object.prototype.hasOwnProperty.call(patch,key))continue;
    if(key==='queue'){
     const fitted=fitQueue(patch.queue??{}, {dropped:patch.dropped??state.dropped});
     state.queue=fitted.queue;state.dropped=fitted.dropped;
    }else state[key]=patch[key];
    dirty.add(key);changed=true;
   }
   if(changed)schedule();
  },
  // AuthContext reads the account file before the app renders, so this adapter is
  // normally handed the real file when it is created. A restored session, an offline
  // start or a screen that opens earlier could hand it an empty one first, and writing
  // an edit from that empty state would replace mirror and queue with almost nothing.
  // Re-reading the file is therefore allowed exactly while nothing has been written
  // here yet: no dirty key, no save in flight, no queued edit and no completed
  // migration. That is a no-op for a fresh account and a recovery for a late
  // hydration, and it can never replace an edit this device already made.
  reseed(preferences){
   if(dirty.size||inFlight||!changesEmpty(state.queue)||state.status.migratedAt||state.status.revision!==null)return state;
   const next=readJourneyState(preferences,owner);
   state.metadata=next.metadata;state.queue=next.queue;state.dropped=next.dropped;state.status=next.status;
   return state;
  },
  // Waits for the pending preferences write, so a test or a screen that is closing can
  // be sure the queue reached the device.
  flush(){return drain();}
 };
}

// The legacy blob, still readable from the settings backup so an upgrade on a new
// device can seed the records instead of asking the user to start over.
export async function readLegacyBlob(client,owner){
 if(!client?.from||!owner)return null;
 try{
  const {data,error}=await client.from('account_settings').select('payload').eq('owner_id',owner).maybeSingle();
  if(error||!data||!data.payload||typeof data.payload!=='object')return null;
  const value=data.payload.journeyGrouping;
  return typeof value==='string'&&value?value:null;
 }catch{return null;}
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
  const size=JSON.stringify(item).length+1;
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
  if(recordTotal(recovered)>0)source=applyChanges(recovered,queued);
 }
 if(recordTotal(source)===0){
  if(!readable&&stored===0){
   const error='Saved journey information on this device could not be read and no cloud copy was found. Nothing has been replaced.';
   write({status:{...read().status,state:'recoveryRequired',error}});
   return {state:'recoveryRequired',error};
  }
  // Nothing to upload: an empty account, or a device adopting the cloud copy.
  source=emptyGrouping(owner);
 }
 const {changes,conflicts}=migrationChanges(source,snapshot.metadata);
 // A queued value is this device's newest answer and goes on top of what the cloud
 // already has, so an edit made between the upgrade and this first run is not dropped
 // when the local mirror is replaced.
 const wanted=mergeChanges(changes,queued);
 const pushed=await pushAll(client,owner,wanted,snapshot.revision);
 const verified=await loadSnapshot(client,owner);
 const missing=missingRecords(applyChanges(snapshot.metadata,wanted),verified.metadata);
 if(missing.length){
  const error=`${missing.length} saved ${missing.length===1?'detail was':'details were'} not stored in the cloud. Nothing on this device has been replaced.`;
  write({status:{...read().status,revision:pushed.revision,state:'incomplete',error}});
  return {state:'incomplete',error,missing:missing.length};
 }
 const effective=applyChanges({...verified.metadata,history:source.history},wanted);
 const reported=conflictSummary(conflicts)??overwrittenSummary(pushed.overwritten);
 write({metadata:fitCache(effective).metadata,queue:{},dropped:{},
  status:{owner,revision:pushed.revision,migratedAt:now(),state:'active',error:null,
   conflicts:reported,updatedAt:verified.updatedAt??null}});
 return {state:'active',conflicts:reported};
}
// The steady state: read first, so an edit made on another device while this one was
// away becomes a pull instead of a conflict; then send what is queued.
async function pullJourneyMetadata({client,owner,read,write},revision){
 const snapshot=await loadSnapshot(client,owner);
 const latest=read();
 const merged=applyChanges({...snapshot.metadata,history:latest.metadata?.history||[]},latest.queue);
 write({metadata:fitCache(merged).metadata,
  status:{...latest.status,revision:snapshot.revision??revision,state:'active',error:null,updatedAt:snapshot.updatedAt??null}});
 return snapshot.revision??revision;
}
export async function flushJourneyMetadata({client,owner,read,write,now=Date.now}){
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
  let sent=pending;
  try{
   const pushed=await pushAll(client,owner,sent,revision);
   revision=pushed.revision;conflicts=overwrittenSummary(pushed.overwritten);
  }catch(error){
   // Both devices wrote between the read and the write. Keep the remote records and
   // send the queued values on top of them once, because a record is a value.
   const latest=await loadRevision(client,owner);
   if(latest===null||!/conflict/i.test(message(error)))throw error;
   revision=await pullJourneyMetadata({client,owner,read,write},latest);
   sent=read().queue;
   const pushed=await pushAll(client,owner,sent,revision);
   revision=pushed.revision;conflicts=overwrittenSummary(pushed.overwritten)??conflicts;
  }
  write({queue:clearPushed(read().queue,sent),
   status:{...read().status,revision,state:'active',error:null,...(conflicts?{conflicts}:{})}});
 }
 return {state:'active',revision};
}
export async function runJourneySync({client,owner,read,write,now=Date.now}){
 if(!client||!owner)return {state:'idle'};
 const status=read().status??emptyStatus(owner);
 try{
  // A device whose own copy cannot be read is not abandoned: another device may upload
  // the records later, and the migration path adopts them. Only a device with nothing
  // readable anywhere stays in recoveryRequired, and it never replaces its own copy.
  if(status.migratedAt)return await flushJourneyMetadata({client,owner,read,write});
  return await migrateJourneyMetadata({client,owner,read,write,now});
 }catch(error){
  const failure=message(error);
  write({status:{...read().status,state:'offline',error:failure}});
  return {state:'offline',error:failure};
 }
}
