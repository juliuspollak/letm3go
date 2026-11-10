// Journey metadata is what the user decided about a group of recordings (merges,
// splits, titles, classifications, tags, stop corrections) plus the enrichment
// answers saved for those recordings (recognised places, reconstructed road gaps,
// distance summaries). Supabase owns it as owner-scoped records; the device holds
// a read-only cache of them.
//
// This module is the one description of those records. It reads the grouped shape
// the rest of the app uses, emits the smallest changed record set between two
// states (the payload of journey_apply_changes), and applies records back onto
// that shape. Nothing here touches React, storage or the network.
import {emptyGrouping} from './journeyGrouping.js';
export const JOURNEY_ENRICHMENT_VERSION=1;
export const ACTIVITY_TYPES=['Driving','Walking','Running','Cycling','MTB','Road cycling','Kitesurfing','Hiking','Gym','Other','Unknown'];
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
const KEY_OF={activities:item=>item.ref,stops:item=>item.ref,places:item=>item.ref,roads:item=>item.ref,summaries:item=>item.ref,
 pairs:item=>`${item.relation}|${pairKey(item.left,item.right)}`};
const DOMAINS=Object.keys(KEY_OF);
export function changesEmpty(changes){
 if(!changes||typeof changes!=='object')return true;
 if(finite(changes.enrichFrom)!==null)return false;
 return DOMAINS.every(name=>list(changes[name]).length===0);
}

// Combines record batches: the later value of a record wins. Records are values,
// not operations, so replaying a batch is idempotent.
export function mergeChanges(base,extra){
 const merged={};
 for(const name of DOMAINS){
  const index=new Map();
  for(const item of [...list(base?.[name]),...list(extra?.[name])])if(record(item)&&KEY_OF[name](item))index.set(KEY_OF[name](item),item);
  if(index.size)merged[name]=[...index.values()];
 }
 const enrichFrom=finite(extra?.enrichFrom)??finite(base?.enrichFrom);
 if(enrichFrom!==null)merged.enrichFrom=enrichFrom;
 return merged;
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
// sent, so editing one journey never rewrites another.
export function groupingChanges(before,after){
 const from=describeGrouping(before),to=describeGrouping(after),changes={};
 for(const name of ['activities','stops','places','roads','summaries']){
  const changed=[];
  for(const [key,item] of to[name])if(JSON.stringify(from[name].get(key))!==JSON.stringify(item))changed.push(item);
  for(const [key,item] of from[name])if(!to[name].has(key))changed.push({...item,delete:true});
  if(changed.length)changes[name]=changed;
 }
 const pairs=[];
 for(const [key,item] of to.pairs)if(JSON.stringify(from.pairs.get(key))!==JSON.stringify(item))pairs.push(item);
 for(const [key,item] of from.pairs)if(!to.pairs.has(key))pairs.push({relation:item.relation,left:item.left,right:item.right,delete:true});
 if(pairs.length)changes.pairs=pairs;
 if(to.enrichFrom!==null&&to.enrichFrom!==from.enrichFrom)changes.enrichFrom=to.enrichFrom;
 return changes;
}
