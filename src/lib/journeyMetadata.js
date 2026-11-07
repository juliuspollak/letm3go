// Journey metadata is what the user decided about a group of recordings (merges,
// splits, titles, classifications, tags, stop corrections) plus the enrichment
// answers saved for those recordings (recognised places, reconstructed road gaps,
// distance summaries). It used to be a single JSON blob inside the device
// preferences file, capped at 900 kB locally and truncated to 300 kB in the cloud
// settings backup. It is now a set of owner-scoped records in Postgres.
//
// This module is the one description of those records. It reads the grouped shape
// the rest of the app already uses, emits the smallest changed set between two
// states, and applies records back onto that shape. The local mirror, the offline
// queue and the database therefore agree by construction. Nothing here touches
// React, storage or the network, so every rule below is unit-testable.
import {emptyGrouping} from './journeyGrouping.js';
export const JOURNEY_METADATA_VERSION=1;
// Bumped only when the enrichment algorithm changes in a way that makes an earlier
// answer worth revisiting. It is stored per activity, never inferred.
export const JOURNEY_ENRICHMENT_VERSION=1;
// The device preferences file is a mirror, not the record. Derived enrichment may
// be dropped from it when it grows past this size; user decisions never are.
export const JOURNEY_CACHE_BYTES=900000;
export const ACTIVITY_TYPES=['Driving','Walking','Running','Cycling','MTB','Road cycling','Kitesurfing','Hiking','Other','Unknown'];
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const list=value=>Array.isArray(value)?value:[];
const strings=value=>list(value).filter(entry=>typeof entry==='string'&&entry.length>0&&entry.length<=60).slice(0,60);
const text=(value,limit)=>typeof value==='string'&&value.length>0&&value.length<=limit?value:null;
const finite=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const pairKey=(left,right)=>[left,right].sort().join('|');
// `edge(a,b)` in journeyGrouping.js is the JSON of two recording ids; a stop that
// lives inside one recording is `dwell:<id>:<timestamp>` or `native:<id>:<timestamp>`.
export function edgePair(key){
 if(typeof key!=='string'||key.length>200)return null;
 try{const value=JSON.parse(key);return Array.isArray(value)&&value.length===2&&value.every(entry=>typeof entry==='string'&&entry.length>0&&entry.length<=80)?value:null;}
 catch{return null;}
}
export function stopRefs(ref){
 const pair=edgePair(ref);
 if(pair)return {after:pair[0],before:pair[1],segment:null};
 const match=typeof ref==='string'?/^(?:dwell|native):([^:]{1,80}):/.exec(ref):null;
 return {after:null,before:null,segment:match?match[1]:null};
}
// A road gap key is `<recording id>:<from timestamp>:<to timestamp>`; the recording
// id itself may contain a colon (`linked:<id>`), so the tail is what identifies it.
export function gapRefs(key){
 const match=typeof key==='string'?/^(.*):\d{1,15}:\d{1,15}$/.exec(key):null;
 return match&&match[1].length<=80?match[1]:null;
}
function activitiesOf(metadata){
 const titles=record(metadata?.titles)?metadata.titles:{},types=record(metadata?.types)?metadata.types:{},
  manual=record(metadata?.manualTags)?metadata.manualTags:{},hidden=record(metadata?.hiddenTags)?metadata.hiddenTags:{},
  enriched=record(metadata?.enriched)?metadata.enriched:{};
 const found=new Map();
 for(const ref of new Set([...Object.keys(titles),...Object.keys(types),...Object.keys(manual),...Object.keys(hidden),...Object.keys(enriched)])){
  if(typeof ref!=='string'||!ref.length||ref.length>80)continue;
  const doneAt=finite(enriched[ref]),type=text(types[ref],40);
  found.set(ref,{ref,title:text(titles[ref],150),type:ACTIVITY_TYPES.includes(type)?type:null,
   manualTags:strings(manual[ref]),hiddenTags:strings(hidden[ref]),enrichedAt:doneAt,
   enrichmentState:doneAt===null?'pending':'done',enrichmentVersion:JOURNEY_ENRICHMENT_VERSION});
 }
 return found;
}

function pairsOf(metadata){
 const found=new Map();
 const add=(relation,left,right)=>{
  if(typeof left!=='string'||typeof right!=='string'||!left||!right||left.length>80||right.length>80||left===right)return;
  found.set(`${relation}|${pairKey(left,right)}`,{relation,left,right});
 };
 for(const key of list(metadata?.links)){const pair=edgePair(key);if(pair)add('link',pair[0],pair[1]);}
 for(const key of list(metadata?.cuts)){const pair=edgePair(key);if(pair)add('cut',pair[0],pair[1]);}
 for(const ids of list(metadata?.sourceLinks))if(Array.isArray(ids)&&ids.length===2)add('source',ids[0],ids[1]);
 return found;
}
function stopsOf(metadata){
 const edits=record(metadata?.stopEdits)?metadata.stopEdits:{},found=new Map();
 for(const [ref,value] of Object.entries(edits)){
  if(typeof ref!=='string'||!ref.length||ref.length>200||!record(value))continue;
  const {after,before,segment}=stopRefs(ref);
  found.set(ref,{ref,after,before,segment,name:text(value.name,100),tags:strings(value.tags),
   replaceTags:value.replaceTags===true,ignored:value.ignored===true});
 }
 return found;
}
function placesOf(metadata){
 const places=record(metadata?.places)?metadata.places:{},found=new Map();
 for(const [ref,lookup] of Object.entries(places))if(record(lookup)&&ref.length<=40)found.set(ref,{ref,lookup});
 return found;
}
function roadsOf(metadata){
 const roads=record(metadata?.roads)?metadata.roads:{},found=new Map();
 for(const [ref,value] of Object.entries(roads))if(record(value)&&ref.length<=120)found.set(ref,{ref,activity:gapRefs(ref),record:value});
 return found;
}
function summariesOf(metadata){
 const summaries=record(metadata?.distanceSummaries)?metadata.distanceSummaries:{},found=new Map();
 for(const [ref,value] of Object.entries(summaries))if(record(value)&&ref.length<=80)found.set(ref,{ref,snapshot:value});
 return found;
}
// Canonical description of one grouping. Every reader and writer goes through it.
export function describeGrouping(metadata){
 return {enrichFrom:finite(metadata?.enrichFrom),activities:activitiesOf(metadata),pairs:pairsOf(metadata),
  stops:stopsOf(metadata),places:placesOf(metadata),roads:roadsOf(metadata),summaries:summariesOf(metadata)};
}
export function recordCounts(metadata){
 const described=describeGrouping(metadata);
 return {activities:described.activities.size,pairs:described.pairs.size,stops:described.stops.size,
  places:described.places.size,roads:described.roads.size,summaries:described.summaries.size,enrichFrom:described.enrichFrom!==null};
}
const KEY_OF={activities:item=>item.ref,stops:item=>item.ref,places:item=>item.ref,roads:item=>item.ref,summaries:item=>item.ref,
 pairs:item=>`${item.relation}|${pairKey(item.left,item.right)}`};
const DOMAINS=Object.keys(KEY_OF);
export function changesEmpty(changes){
 if(!changes||typeof changes!=='object')return true;
 if(finite(changes.enrichFrom)!==null)return false;
 return DOMAINS.every(name=>list(changes[name]).length===0);
}

// The local queue keeps full record values, not operations, so replaying it is
// idempotent: a restarted app, a retried request and a second device all converge.
export function mergeChanges(base,extra){
 const merged={};
 for(const name of DOMAINS){
  const index=new Map();
  for(const item of list(base?.[name]))if(record(item)&&KEY_OF[name](item))index.set(KEY_OF[name](item),item);
  for(const value of list(extra?.[name]))if(record(value)&&KEY_OF[name](value)){
   let item=value;
   if(name==='pairs'&&['link','cut'].includes(item.relation)){
    const previous=[...index.values()].find(entry=>['link','cut'].includes(entry.relation)&&pairKey(entry.left,entry.right)===pairKey(item.left,item.right));
    if(previous&&Object.hasOwn(previous,'_baseRelation'))item={...item,_baseRelation:previous._baseRelation};
   }
   const prior=index.get(KEY_OF[name](item));index.set(KEY_OF[name](item),prior?coalesceRecord(prior,item):item);
  }
  if(index.size)merged[name]=[...index.values()];
 }
 const enrichFrom=finite(extra?.enrichFrom)??finite(base?.enrichFrom);
 if(enrichFrom!==null)merged.enrichFrom=enrichFrom;
 return merged;
}
// Drops the records the cloud confirmed, keeping anything edited while the request
// was in flight. A record whose value changed is still queued.
export function clearPushed(base,pushed){
 const remaining={};
 for(const name of DOMAINS){
  const index=new Map();
  for(const item of list(base?.[name]))if(record(item)&&KEY_OF[name](item))index.set(KEY_OF[name](item),item);
  for(const item of list(pushed?.[name])){
   if(!record(item))continue;
   const key=KEY_OF[name](item);
   if(key&&JSON.stringify(index.get(key))===JSON.stringify(item))index.delete(key);
  }
  if(index.size)remaining[name]=[...index.values()];
 }
 if(finite(base?.enrichFrom)!==null&&base.enrichFrom===pushed?.enrichFrom)delete remaining.enrichFrom;
 else if(finite(base?.enrichFrom)!==null)remaining.enrichFrom=base.enrichFrom;
 return remaining;
}
// Everything the cloud lacks. Records the cloud already has are never overwritten
// by a legacy device blob, so an older backup cannot replace a newer edit.
export function migrationChanges(local,snapshot){
 const mine=describeGrouping(local),theirs=describeGrouping(snapshot);
 const changes={},conflicts={activities:0,pairs:0,stops:0,places:0,roads:0,summaries:0};
 for(const name of ['activities','pairs','stops','places','roads','summaries']){
  const additions=[];
  for(const [key,item] of mine[name]){
   const existing=theirs[name].get(key);
   if(!existing)additions.push(item);
   else if(JSON.stringify(existing)!==JSON.stringify(item))conflicts[name]+=1;
  }
  if(additions.length)changes[name]=additions;
 }
 // The enrichment cutoff is set once per account. A cloud value wins if it has one.
 if(mine.enrichFrom!==null&&theirs.enrichFrom===null)changes.enrichFrom=mine.enrichFrom;
 return {changes:mergeChanges({},changes),conflicts};
}

// Applies records onto a grouping. A pull, a replayed queue and a local edit all
// use this path, so the shape the UI reads is identical however it arrived.
export function applyChanges(metadata,changes){
 const base=metadata&&typeof metadata==='object'?{...emptyGrouping(metadata.owner),...metadata}:emptyGrouping(null);
 const next={...base,titles:{...base.titles},types:{...base.types},manualTags:{...base.manualTags},hiddenTags:{...base.hiddenTags},
  stopEdits:{...base.stopEdits},places:{...base.places},roads:{...base.roads},enriched:{...base.enriched},
  distanceSummaries:{...base.distanceSummaries},links:[...base.links],cuts:[...base.cuts],sourceLinks:[...base.sourceLinks]};
 for(const item of list(changes?.activities)){
  if(!record(item)||typeof item.ref!=='string'||!item.ref)continue;
  const removed=item.delete===true,ref=item.ref,title=removed?null:text(item.title,150),type=removed?null:text(item.type,40),doneAt=removed?null:finite(item.enrichedAt);
  if(title)next.titles[ref]=title;else delete next.titles[ref];
  if(type&&ACTIVITY_TYPES.includes(type))next.types[ref]=type;else delete next.types[ref];
  const manualTags=removed?[]:strings(item.manualTags),hiddenTags=removed?[]:strings(item.hiddenTags);
  if(manualTags.length)next.manualTags[ref]=manualTags;else delete next.manualTags[ref];
  if(hiddenTags.length)next.hiddenTags[ref]=hiddenTags;else delete next.hiddenTags[ref];
  if(doneAt!==null)next.enriched[ref]=doneAt;else delete next.enriched[ref];
 }
 for(const item of list(changes?.pairs)){
  if(!record(item))continue;
  const {left,right}=item;
  if(typeof left!=='string'||typeof right!=='string'||!left||!right||left.length>80||right.length>80)continue;
  const same=ids=>Array.isArray(ids)&&pairKey(ids[0],ids[1])===pairKey(left,right);
  const other=entry=>{const pair=edgePair(entry);return !pair||pairKey(pair[0],pair[1])!==pairKey(left,right);};
  if(item.relation==='link')next.links=next.links.filter(other);
  if(item.relation==='cut')next.cuts=next.cuts.filter(other);
  if(item.relation==='source')next.sourceLinks=next.sourceLinks.filter(ids=>!same(ids));
  if(item.delete===true)continue;
  if(item.relation==='link')next.cuts=next.cuts.filter(other);
  if(item.relation==='cut')next.links=next.links.filter(other);
  if(item.relation==='link')next.links=[...next.links,JSON.stringify([left,right].sort())];
  else if(item.relation==='cut')next.cuts=[...next.cuts,JSON.stringify([left,right].sort())];
  else if(item.relation==='source')next.sourceLinks=[...next.sourceLinks,[left,right]];
 }
 for(const item of list(changes?.stops)){
  if(!record(item)||typeof item.ref!=='string'||!item.ref)continue;
  const removed=item.delete===true,name=removed?null:text(item.name,100),tags=removed?[]:strings(item.tags);
  if(removed||(!name&&!tags.length&&item.replaceTags!==true&&item.ignored!==true)){delete next.stopEdits[item.ref];continue;}
  next.stopEdits[item.ref]={...(name?{name}:{}),...(tags.length?{tags}:{}),
   ...(item.replaceTags===true?{replaceTags:true}:{}),...(item.ignored===true?{ignored:true}:{})};
 }
 for(const name of ['places','roads','summaries']){
  const target=name==='places'?next.places:name==='roads'?next.roads:next.distanceSummaries;
  for(const item of list(changes?.[name])){
   if(!record(item)||typeof item.ref!=='string'||!item.ref)continue;
   if(item.delete===true){delete target[item.ref];continue;}
   const value=name==='places'?item.lookup:name==='roads'?item.record:item.snapshot;
   if(record(value))target[item.ref]=value;
  }
 }
 if(finite(changes?.enrichFrom)!==null)next.enrichFrom=changes.enrichFrom;
 return next;
}

// The smallest record set that turns `before` into `after`. Only changed records are
// sent, so two devices editing different journeys never overwrite each other.
export function groupingChanges(before,after){
 const from=describeGrouping(before),to=describeGrouping(after),changes={};
 for(const name of ['activities','stops','places','roads','summaries']){
  const changed=[];
  for(const [key,item] of to[name])if(JSON.stringify(from[name].get(key))!==JSON.stringify(item))changed.push(withFields(name,from[name].get(key),item));
  for(const [key,item] of from[name])if(!to[name].has(key))changed.push(withFields(name,item,{...item,delete:true}));
  if(changed.length)changes[name]=changed;
 }
 const pairs=[];
 for(const [key,item] of to.pairs)if(JSON.stringify(from.pairs.get(key))!==JSON.stringify(item))pairs.push(item);
 for(const [key,item] of from.pairs)if(!to.pairs.has(key))pairs.push({relation:item.relation,left:item.left,right:item.right,delete:true});
 if(pairs.length)changes.pairs=pairs.map(item=>{
  if(!['link','cut'].includes(item.relation))return item;
  const previous=[...from.pairs.values()].find(entry=>['link','cut'].includes(entry.relation)&&pairKey(entry.left,entry.right)===pairKey(item.left,item.right));
  return {...item,_baseRelation:previous?.relation??null};
 });
 if(to.enrichFrom!==null&&to.enrichFrom!==from.enrichFrom)changes.enrichFrom=to.enrichFrom;
 return changes;
}
// Records the cloud does not have, or has differently. Used to prove a migration
// completed before the local mirror is replaced. The enrichment cutoff is part of
// that proof: recordings saved before it are history on every device.
export function missingRecords(expected,snapshot){
 const wanted=describeGrouping(expected),have=describeGrouping(snapshot),missing=[];
 for(const name of ['activities','pairs','stops','places','roads','summaries'])
  for(const [key,item] of wanted[name])if(JSON.stringify(have[name].get(key))!==JSON.stringify(item))missing.push({domain:name,ref:key});
 if(wanted.enrichFrom!==null&&have.enrichFrom!==wanted.enrichFrom)missing.push({domain:'enrichFrom',ref:'enrichFrom'});
 return missing;
}
// Keeps the device mirror inside the native preference limit by dropping derived
// enrichment, oldest first. A title, merge, tag or stop correction is never dropped.
export function fitCache(metadata,limit=JOURNEY_CACHE_BYTES){
 const sizeOf=value=>JSON.stringify(value).length;
 let total=sizeOf(metadata);
 if(total<=limit)return {metadata,evicted:0};
 const next={...metadata};let evicted=0;
 for(const name of ['roads','distanceSummaries','places']){
  if(total<=limit)break;
  const entries=Object.entries(next[name]||{});
  if(!entries.length)continue;
  const age=entry=>Number(entry[1]?.lookedUpAt??entry[1]?.computedAt)||0;
  entries.sort((first,second)=>age(first)-age(second));
  const kept={...next[name]};
  for(const [key,value] of entries){
   if(total<=limit)break;
   // An under-estimate per record, so the loop never stops while still above the limit.
   const cost=JSON.stringify(key).length+JSON.stringify(value).length+1;
   delete kept[key];evicted+=1;total-=cost;
  }
  next[name]=kept;
 }
 return {metadata:next,evicted};
}

// Pending writes are never evicted. Capacity failures must reject the transaction.
export const JOURNEY_QUEUE_BYTES=400000; // old builds' threshold, for upgrade tests
export const JOURNEY_QUEUE_HARD_BYTES=800000;
export function fitQueue(changes,{dropped={}}={}){return {queue:mergeChanges({},changes),dropped};}
export function queueSize(changes){return JSON.stringify(mergeChanges({},changes)).length;}
export function droppedTotal(dropped){return Object.values(dropped||{}).reduce((sum,count)=>sum+(Number(count)||0),0);}

const FIELDS={activities:['title','type','manualTags','hiddenTags','enrichedAt'],stops:['name','tags','replaceTags','ignored']};
const normalized=(item,field)=>item?.delete?defaultField(field):item?.[field]??defaultField(field);
const defaultField=field=>['manualTags','hiddenTags','tags'].includes(field)?[]:['replaceTags','ignored'].includes(field)?false:null;
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function withFields(domain,before,after){
 if(!FIELDS[domain])return after;
 const fields=FIELDS[domain].filter(field=>!equal(normalized(before,field),normalized(after,field)));
 return {...after,_fields:fields,_base:Object.fromEntries(fields.map(field=>[field,normalized(before,field)]))};
}
function coalesceRecord(prior,item){
 if(!item._fields)return item;
 if(!prior._fields){
  const preserved={...item,_fields:undefined,_base:undefined};
  for(const field of ['title','type','manualTags','hiddenTags','enrichedAt','name','tags','replaceTags','ignored'])
   if(!item._fields.includes(field)&&Object.hasOwn(prior,field))preserved[field]=prior[field];
  return preserved;
 }
 return {...item,_fields:[...new Set([...prior._fields,...item._fields])],_base:{...item._base,...prior._base}};
}
// Three-way merge under the account revision CAS. Independent fields commute;
// competing values of the same field stay queued and are reported, never replaced.
export function rebaseChanges(changes,remote){
 const described=describeGrouping(remote),result=mergeChanges({},changes),conflicts=[];
 const relationships=new Map([...described.pairs.values()].filter(item=>['link','cut'].includes(item.relation)).map(item=>[pairKey(item.left,item.right),item.relation]));
 const desired=new Map((result.pairs||[]).filter(item=>['link','cut'].includes(item.relation)&&!item.delete).map(item=>[pairKey(item.left,item.right),item.relation]));
 if(result.pairs)result.pairs=result.pairs.map(item=>{
  if(!['link','cut'].includes(item.relation))return item;
  const key=pairKey(item.left,item.right),stored=relationships.get(key)??null,wanted=desired.get(key)??null;
  if(stored!==wanted&&(Object.hasOwn(item,'_baseRelation')?stored!==item._baseRelation:stored!==null))
   conflicts.push({domain:'pairs',ref:JSON.stringify([item.left,item.right].sort()),field:'grouping',local:wanted,remote:stored});
  return {...item,_baseRelation:stored};
 });

 for(const domain of ['activities','stops']){
  result[domain]=(result[domain]||[]).map(item=>{
   const current=described[domain].get(item.ref);
   if(!item._fields){
    if(current&&!equal(current,item)&&!equal({...current,delete:true},item))conflicts.push({domain,ref:item.ref,field:'legacy record',local:item,remote:current});
    return item;
   }
   const next={...(current||{ref:item.ref}),_fields:item._fields,_base:{}};
   for(const field of item._fields){
    const value=normalized(item,field),stored=normalized(current,field),base=item._base[field];
    if(!equal(stored,base)&&!equal(stored,value))conflicts.push({domain,ref:item.ref,field,local:value,remote:stored});
    next[field]=value;next._base[field]=stored;
   }
   return next;
  });
  if(!result[domain].length)delete result[domain];
 }
 return {changes:result,conflicts};
}

// Fail visibly on legacy values the current record protocol cannot represent.
// Keeping the original disk rows is safer than verifying a truncated projection.
export function assertLosslessGrouping(metadata){
 if(!metadata)return;
 const described=describeGrouping(metadata),changes={};
 for(const domain of DOMAINS)changes[domain]=[...described[domain].values()];
 const projected=applyChanges(emptyGrouping(metadata.owner),changes);
 const canonical=value=>JSON.stringify(value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
 for(const field of ['titles','types','manualTags','hiddenTags','enriched','stopEdits','places','roads','distanceSummaries']){
  for(const [ref,raw] of Object.entries(metadata[field]||{})){
   let value=raw;
   if(field==='stopEdits'&&record(raw)){
    value={...raw};
    if(Array.isArray(value.tags)&&!value.tags.length)delete value.tags;
    for(const flag of ['replaceTags','ignored'])if(value[flag]===false)delete value[flag];
    if(value.name==null||value.name==='')delete value.name;
    if(!Object.keys(value).length)value=undefined;
   }
   if(['manualTags','hiddenTags'].includes(field)&&Array.isArray(value)&&!value.length)value=undefined;
   if(['titles','types','enriched'].includes(field)&&value===null)value=undefined;
   if(canonical(projected[field][ref])!==canonical(value))
    throw new Error(`Saved journey ${field} for ${ref} cannot be migrated without loss. The original device records were preserved.`);
  }
 }
 for(const field of ['links','cuts','sourceLinks'])if((metadata[field]||[]).length!==projected[field].length)
  throw new Error('Saved journey pairs cannot be migrated without loss. The original device records were preserved.');
}
