import {dayWindow} from './dayWindow.js';
import {decodeLine} from './gapReconstruction.js';
import {trailLines} from './liveTrail.js';

// One person's day, composed from the activities shared with the viewer plus their
// live trail. One implementation for everyone: only where the rows come from (and
// what the server lets through) differs between myself, household and friends.
const SPREAD_METRES=25,MAX_MARKERS=60;
const num=n=>Number.isFinite(n);
const usable=p=>p&&num(p.latitude)&&num(p.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180;

// Points of one activity inside the day window. The neighbouring point just
// outside stays when it continues the same segment, so a drive across midnight is
// one unbroken line on each day with no vertex duplicated within a day.
export function clipToWindow(points,window){
 const out=[];
 for(let i=0;i<points.length;i++){
  const p=points[i];
  if(!usable(p)||!num(p.t))continue;
  if(p.t>=window.start&&p.t<window.end){out.push(p);continue;}
  const before=p.t<window.start&&points[i+1]&&points[i+1].t>=window.start&&points[i+1].segment===p.segment;
  const after=p.t>=window.end&&points[i-1]&&points[i-1].t<window.end&&points[i-1].segment===p.segment;
  if(before||after)out.push({...p,bridge:true});
 }
 return out;
}
function lines(points){
 const result=[];let segment=null;
 for(const p of points){
  if(!result.length||p.segment!==segment){result.push([]);segment=p.segment;}
  result.at(-1).push([p.latitude,p.longitude]);
 }
 return result.filter(line=>line.length>1);
}
const metres=(a,b)=>{const k=111320,dy=(a[0]-b[0])*k,dx=(a[1]-b[1])*k*Math.cos(a[0]*Math.PI/180);return Math.hypot(dx,dy);};
// Markers that fall on the same spot are fanned out around it, deterministically,
// so every one stays tappable; the badge number is unchanged.
export function spreadMarkers(markers){
 const placed=[];
 return markers.map(marker=>{
  const near=placed.filter(p=>metres(p.point,marker.point)<SPREAD_METRES).length;
  placed.push(marker);
  if(!near)return marker;
  const angle=near*2.4,radius=0.00014*Math.ceil(near/6);
  return {...marker,point:[marker.point[0]+Math.sin(angle)*radius,marker.point[1]+Math.cos(angle)*radius]};
 });
}
export function composeDay({rows=[],live=null,timeZone,date,now=Date.now()/1000}){
 const window=dayWindow(date,timeZone);
 const activities=[];
 for(const row of [...rows].sort((a,b)=>Date.parse(a.started_at)-Date.parse(b.started_at))){
  const points=clipToWindow(Array.isArray(row.points)?row.points:[],window);
  const timed=points.filter(p=>!p.bridge);
  if(!timed.length)continue;
  const roads=Object.entries(row.roads||{}).map(([ref,line])=>({ref,line:decodeLine(line)})).filter(r=>r.line.length>1);
  activities.push({id:row.activity_id,title:row.title||'Activity',activity:row.activity,startedAt:Date.parse(row.started_at)/1000,
   routes:lines(points),roads,points:timed,start:[timed[0].latitude,timed[0].longitude]});
 }
 const markers=spreadMarkers(activities.slice(0,MAX_MARKERS).map((a,i)=>({n:i+1,activityID:a.id,point:a.start,title:`${i+1}. ${a.title}`})));
 // Time lookups use one flat, sorted list of recorded fixes. A road estimate has no
 // timestamps of its own, so none are invented for it.
 const samples=activities.flatMap(a=>a.points.map(p=>({t:p.t,lat:p.latitude,lon:p.longitude,segment:p.segment,id:a.id}))).sort((a,b)=>a.t-b.t);
 const liveTrail=live&&live.points?.length?live.points.filter(p=>p[2]>=window.start&&p[2]<window.end):[];
 for(const p of liveTrail)samples.push({t:p[2],lat:p[0],lon:p[1],segment:`live:${p[3]}`,id:'live'});
 samples.sort((a,b)=>a.t-b.t);
 const isToday=now>=window.start&&now<window.end;
 return {date,window,activities,markers,samples,
  recorded:activities.flatMap(a=>a.routes),
  estimated:activities.flatMap(a=>a.roads.map(r=>r.line)),
  live:isToday?trailLines(liveTrail):[],
  liveRoads:isToday?Object.values(live?.roads||{}).map(decodeLine).filter(l=>l.length>1):[],
  isEmpty:!activities.length&&!liveTrail.length};
}
// Where the person was at a time: the last recorded fix at or before it. Inside a
// gap this is the fix before the gap, flagged, never a guessed point on a road.
export function positionAt(day,t){
 const s=day.samples;if(!s.length||t<s[0].t)return null;
 let lo=0,hi=s.length-1;
 while(lo<hi){const mid=(lo+hi+1)>>1;if(s[mid].t<=t)lo=mid;else hi=mid-1;}
 const p=s[lo],next=s[lo+1];
 return {point:[p.lat,p.lon],t:p.t,id:p.id,inGap:Boolean(next&&next.segment!==p.segment&&t<next.t),ageSeconds:t-p.t};
}
// The day's lines drawn only up to a time, for scrubbing (all in memory).
export function linesUntil(day,t){
 const out=[];let segment=null,id=null;
 for(const s of day.samples){
  if(s.t>t)break;
  if(!out.length||s.segment!==segment||s.id!==id){out.push([]);segment=s.segment;id=s.id;}
  out.at(-1).push([s.lat,s.lon]);
 }
 return out.filter(line=>line.length>1);
}
