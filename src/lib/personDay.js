import {liveRoad} from './liveRoads.js';
import {dayWindow} from './dayWindow.js';
import {decodeLine,routeGaps,gapKey} from './gapReconstruction.js';
import {trailLines,mergeTrail} from './liveTrail.js';

// One person's day, composed from the activities shared with the viewer plus their
// live trail. One implementation for everyone: only where the rows come from (and
// what the server lets through) differs between myself, household and friends.
// The recorder treats a silence over three minutes as unobserved even when
// stationary. Shared/thinned fixes lack accuracy and mode: use that conservative
// ceiling, rather than interpreting sparse display samples as precise coverage.
const unobserved=(a,b)=>a.segment!==b.segment||b.t-a.t>180;
// Gap references already contain the two real endpoint times. An estimate belongs
// whole to the viewer-local day of its FIRST fix, even across midnight: we cannot
// split a guessed road into accurately timed portions. Unknown legacy keys are
// shown only if the entire activity fits this day.
function roadsInWindow(roads,window,begun,ended){
 return Object.entries(roads||{}).filter(([ref])=>{
  const match=/:([0-9]+):([0-9]+)$/.exec(ref);
  if(!match)return begun>=window.start&&ended<window.end;
  const t=Number(match[1]);return t>=window.start&&t<window.end;
 }).map(([ref,line])=>({ref,line:decodeLine(line)})).filter(r=>r.line.length>1);
}
const num=n=>Number.isFinite(n);
const usable=p=>p&&num(p.latitude)&&num(p.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180;

// Points of one activity inside the day window. The neighbouring point just
// outside stays when it continues the same segment, so a drive across midnight is
// one unbroken line on each day with no vertex duplicated within a day.
export function clipToWindow(points,window,untimed=false){
 const out=[];
 for(let i=0;i<points.length;i++){
  const p=points[i];
  if(!usable(p)||!num(p.t))continue;
  if(p.t>=window.start&&p.t<window.end){out.push(p);continue;}
  const before=p.t<window.start&&points[i+1]&&points[i+1].t>=window.start&&(untimed?p.segment===points[i+1].segment:!unobserved(p,points[i+1]));
  const after=p.t>=window.end&&points[i-1]&&points[i-1].t<window.end&&(untimed?p.segment===points[i-1].segment:!unobserved(points[i-1],p));
  if(before||after)out.push({...p,bridge:true});
 }
 return out;
}
function lines(points,untimed=false){
 const result=[];let previous=null;
 for(const p of points){
  if(!previous||(untimed?previous.segment!==p.segment:unobserved(previous,p))){result.push([]);}
  result.at(-1).push([p.latitude,p.longitude]);previous=p;
 }
 return result.filter(line=>line.length>1);
}
export function composeDay({rows=[],live=null,timeZone,date,now=Date.now()/1000}){
 const window=dayWindow(date,timeZone);
 const activities=[];
 for(const row of [...rows].sort((a,b)=>Date.parse(a.started_at)-Date.parse(b.started_at))){
  // Activities shared before capture times were included have geometry but no per-point
  // time. They are placed on the day by their start and end, drawn, and left out of
  // time lookups: nothing is guessed about where the person was at a given minute.
  const raw=Array.isArray(row.points)?row.points:[];
  const untimed=raw.length>1&&!raw.some(p=>num(p.t));
  const begun=Date.parse(row.started_at)/1000,ended=Date.parse(row.ended_at)/1000;
  const spread=untimed&&num(begun)&&num(ended)&&ended>begun
   ?raw.map((p,i)=>({...p,t:begun+(ended-begun)*i/(raw.length-1)})):raw;
  const points=clipToWindow(spread,window,untimed);
  const timed=points.filter(p=>!p.bridge);
  if(!timed.length)continue;
  const roads=roadsInWindow(row.roads,window,begun,ended);
  activities.push({untimed,id:row.activity_id,title:row.title||'Activity',activity:row.activity,startedAt:begun,durationSeconds:Number.isFinite(ended-begun)?Math.max(0,ended-begun):null,
   routes:lines(points,untimed),roads,points:timed,start:[timed[0].latitude,timed[0].longitude]});
 }
 const markers=activities.map((a,i)=>({n:i+1,activityID:a.id,point:a.start,title:`${i+1}. ${a.title}`}));
 // Time lookups use one flat, sorted list of recorded fixes. A road estimate has no
 // timestamps of its own, so none are invented for it.
 const samples=activities.filter(a=>!a.untimed).flatMap(a=>a.points.map(p=>({t:p.t,lat:p.latitude,lon:p.longitude,segment:p.segment,id:a.id}))).sort((a,b)=>a.t-b.t);
 // A completed row wins during the overlap between backup and the live end signal.
 const finalised=live&&rows.some(row=>String(row.activity_id).toLowerCase()===String(live.ref).toLowerCase());
 const liveTrail=!finalised&&live&&live.points?.length?live.points.filter(p=>p[2]>=window.start&&p[2]<window.end):[];
 for(const p of liveTrail)samples.push({t:p[2],lat:p[0],lon:p[1],segment:`live:${p[3]}`,id:'live'});
 samples.sort((a,b)=>a.t-b.t);
 // Overlapping recordings interleave in time; each sample knows the next one of its own
 // recording, so gaps and lines are judged within one recording, never across two.
 const lastOf=new Map();
 for(let i=samples.length-1;i>=0;i--){
  const next=lastOf.get(samples[i].id)??-1;
  samples[i].nextSame=next;
  samples[i].gapAfter=next>=0&&unobserved(samples[i],samples[next]);
  lastOf.set(samples[i].id,i);
 }
 const isToday=now>=window.start&&now<window.end;
 return {date,window,activities,markers,samples,
  recorded:activities.flatMap(a=>a.routes),
  // Activities with no per-point times are always drawn whole; the slider cannot place them.
  untimed:activities.filter(a=>a.untimed).flatMap(a=>a.routes),
  estimated:activities.flatMap(a=>a.roads.map(r=>r.line)),
  live:isToday?trailLines(liveTrail):[],
  liveRoads:isToday&&!finalised?roadsInWindow(live?.roads,window,NaN,NaN).map(r=>r.line):[],
  isEmpty:!activities.length&&!liveTrail.length};
}
// Where the person was at a time: the last recorded fix at or before it. Inside a gap this
// is the fix before the gap, flagged, never a guessed point on a road.
export function positionAt(day,t){
 const s=day.samples;if(!s.length||t<s[0].t)return null;
 let lo=0,hi=s.length-1;
 while(lo<hi){const mid=(lo+hi+1)>>1;if(s[mid].t<=t)lo=mid;else hi=mid-1;}
 const p=s[lo],next=p.nextSame>=0?s[p.nextSame]:null;
 // In a gap: this recording's next fix starts a new segment, or the recording is over and
 // the day has later fixes (nothing was being recorded in between).
 const over=!next&&lo<s.length-1;
 return {point:[p.lat,p.lon],t:p.t,id:p.id,inGap:Boolean(over||(next&&p.gapAfter&&t>p.t&&t<next.t)),ageSeconds:t-p.t};
}
// The day's lines drawn only up to a time, for scrubbing (all in memory). Runs are built once
// per composed day, one stream per recording and segment; a scrub step is a binary search
// over the shared time order and a few slices.
function runsOf(day){
 if(day.runs)return day.runs;
 const runs=[],open=new Map();
 day.samples.forEach((sample,index)=>{
  let run=open.get(sample.id);
  if(!run||run.gapAfter){run={segment:sample.segment,indexes:[],points:[]};open.set(sample.id,run);runs.push(run);}
  run.indexes.push(index);run.points.push([sample.lat,sample.lon]);run.gapAfter=sample.gapAfter;
 });
 day.runs=runs;
 return runs;
}
export function linesUntil(day,t){
 const s=day.samples;let lo=0,hi=s.length;
 while(lo<hi){const mid=(lo+hi)>>1;if(s[mid].t<=t)lo=mid+1;else hi=mid;}
 const out=[];
 for(const run of runsOf(day)){
  if(run.indexes[0]>=lo)continue;
  let a=0,b=run.indexes.length;
  while(a<b){const mid=(a+b)>>1;if(run.indexes[mid]<lo)a=mid+1;else b=mid;}
  if(a>1)out.push(a===run.points.length?run.points:run.points.slice(0,a));
 }
 return out;
}

// ---- My own day, including what is still only on this phone -----------------------------
// A finished activity is on the phone with its full route as soon as it is saved; the cloud
// copy appears after the backup. The own-day map merges both into the same rows the social
// map uses, by activity id (the recorder writes ids in upper case, the cloud in lower case).
const ROUTE_MAX=1500;
// At most ROUTE_MAX fixes, keeping the first, the last and both ends of every GPS segment.
export function thinRoutePoints(points,max=ROUTE_MAX){
 const n=points.length;
 if(n<=max)return points;
 const step=Math.ceil(n/max);
 return points.filter((p,i)=>i===0||i===n-1||i%step===0||p.segment!==points[i-1].segment||p.segment!==points[i+1]?.segment);
}
const idKey=id=>String(id).toLowerCase();
export function localDayRows(trips=[],window,deleted=[]){
 const gone=new Set(deleted.map(idKey));
 return trips.filter(t=>t&&t.id&&!gone.has(idKey(t.id))&&['device','watch'].includes(t.source)&&t.details?.provisional!==true&&Number.isFinite(t.startedAt)&&Number.isFinite(t.endedAt)
   &&t.startedAt<window.end&&t.endedAt>window.start&&Array.isArray(t.points))
  .map(t=>({activity_id:idKey(t.id),title:t.title||t.activity||'Activity',activity:t.activity,started_at:new Date(t.startedAt*1000).toISOString(),ended_at:new Date(t.endedAt*1000).toISOString(),
   points:thinRoutePoints(t.points.filter(p=>Number.isFinite(p?.latitude)&&Number.isFinite(p?.longitude)&&Number.isFinite(p?.timestamp))
     .map(p=>({latitude:p.latitude,longitude:p.longitude,segment:p.segment??0,t:Math.round(p.timestamp)}))),roads:{},local:true}));
}
// One row per activity. The phone's copy supplies the route (it is the finished one, and it
// is there before the backup); the cloud copy supplies the road estimates the phone does not
// hold; a row deleted on this phone never comes back from a stale cloud copy.
export function mergeOwnRows(cloud=[],local=[],deleted=[]){
 const gone=new Set(deleted.map(idKey)),byId=new Map();
 for(const row of cloud)if(!gone.has(idKey(row.activity_id)))byId.set(idKey(row.activity_id),row);
 for(const row of local){
  const held=byId.get(idKey(row.activity_id));
  byId.set(idKey(row.activity_id),held?{...held,...row,roads:{...(held.roads||{}),...(row.roads||{})},etag:held.etag}:row);
 }
 return [...byId.values()];
}

// Owners can see the recorder's own unfinished route without enabling sharing.
// Same bounded wire geometry as the server; reuse already-computed road records.
export function localLiveTrail(trip){
 if(!trip||!['device','watch'].includes(trip.source)||!(trip.state==='recording'||trip.state==='paused'||trip.details?.provisional===true))return null;
 const points=mergeTrail([],thinRoutePoints(trip.points||[],3000).map(p=>[p.latitude,p.longitude,Math.round(p.timestamp),p.segment??0]));
 const roads={};
 for(const gap of routeGaps(trip,{live:true})){
  const key=gapKey(trip.id,gap),record=liveRoad(key);
  if(record?.status==='route'&&record.line)roads[key]=record.line;
 }
 return {ref:trip.id,points,roads};
}
