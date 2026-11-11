import {describe,expect,it} from 'vitest';
import {addDays,dayKeyOf,dayWindow} from './dayWindow.js';
import {mergeTrail,newestTime,trailLines} from './liveTrail.js';
import {clipToWindow,composeDay,linesUntil,positionAt,spreadMarkers} from './personDay.js';
import {encodeLine} from './gapReconstruction.js';

const SYD='Australia/Sydney',LA='America/Los_Angeles';
const hours=(key,zone)=>{const w=dayWindow(key,zone);return (w.end-w.start)/3600;};
describe('day windows',()=>{
 it('are 23 and 25 hours long on daylight-saving changes, 24 otherwise',()=>{
  expect(hours('2026-10-04',SYD)).toBe(23);expect(hours('2027-04-04',SYD)).toBe(25);expect(hours('2026-10-05',SYD)).toBe(24);
  expect(hours('2027-03-14',LA)).toBe(23);expect(hours('2026-11-01',LA)).toBe(25);
 });
 it('tile exactly: one day ends where the next begins, and instants map back to their day',()=>{
  const a=dayWindow('2026-10-04',SYD),b=dayWindow('2026-10-05',SYD);
  expect(a.end).toBe(b.start);
  expect(dayKeyOf(a.end-1,SYD)).toBe('2026-10-04');expect(dayKeyOf(a.end,SYD)).toBe('2026-10-05');
  expect(addDays('2026-12-31',1)).toBe('2027-01-01');expect(addDays('2027-03-01',-1)).toBe('2027-02-28');
 });
});
describe('live trail merge',()=>{
 const p=(t,seg=0)=>[-34+t/1e6,150,t,seg];
 it('is order-free and idempotent, and ignores invalid points',()=>{
  const once=mergeTrail([],[p(3),p(1),p(2)]);
  expect(once.map(x=>x[2])).toEqual([1,2,3]);
  expect(mergeTrail(once,[p(2),p(3)])).toEqual(once);
  expect(mergeTrail(mergeTrail([],[p(2)]),[p(3),p(1)])).toEqual(once);
  expect(mergeTrail(once,[[95,0,9,0],[NaN,1,9,0],null]).length).toBe(3);
  expect(newestTime(once)).toBe(3);expect(newestTime([])).toBe(0);
 });
 it('keeps only the newest points when bounded',()=>{
  expect(mergeTrail([],Array.from({length:50},(_,i)=>p(i+1)),10).map(x=>x[2])).toEqual(Array.from({length:10},(_,i)=>i+41));
 });
 it('breaks lines at a GPS gap and drops single points',()=>{
  expect(trailLines([p(1,0),p(2,0),p(3,1),p(4,1),p(5,2)]).map(l=>l.length)).toEqual([2,2]);
 });
});
const T0=Date.parse('2026-11-10T12:00:00Z')/1000;
const row=(id,title,start,pts,extra={})=>({activity_id:id,title,activity:'Driving',started_at:new Date(start*1000).toISOString(),
 points:pts.map(([t,lat,lon,segment=0])=>({latitude:lat,longitude:lon,segment,t})),roads:{},...extra});
describe('composing a day',()=>{
 const date=dayKeyOf(T0,SYD),w=dayWindow(date,SYD);
 it('numbers activities in time order and marks each at its start',()=>{
  const day=composeDay({date,timeZone:SYD,rows:[
   row('b','Work to shops',w.start+7200,[[w.start+7200,-34.4,150.8],[w.start+7300,-34.41,150.81]]),
   row('a','Home to work',w.start+3600,[[w.start+3600,-34.5,150.9],[w.start+3700,-34.51,150.91]])]});
  expect(day.markers.map(m=>[m.n,m.activityID,m.title])).toEqual([[1,'a','1. Home to work'],[2,'b','2. Work to shops']]);
  expect(day.markers[0].point).toEqual([-34.5,150.9]);
  expect(day.recorded.length).toBe(2);
 });
 it('splits an activity across midnight without losing or doubling geometry',()=>{
  const next=dayWindow(addDays(date,1),SYD);
  const pts=[[w.end-120,-34.5,150.9],[w.end-60,-34.51,150.9],[w.end+60,-34.52,150.9],[w.end+120,-34.53,150.9]];
  const r=row('x','Late drive',w.end-120,pts);
  const first=composeDay({date,timeZone:SYD,rows:[r]}),second=composeDay({date:addDays(date,1),timeZone:SYD,rows:[r]});
  expect(first.samples.length).toBe(2);expect(second.samples.length).toBe(2);
  expect(first.samples.length+second.samples.length).toBe(4);
  // The line is continuous on both days: each draws the vertex across the boundary.
  expect(first.recorded[0].length).toBe(3);expect(second.recorded[0].length).toBe(3);
  expect(clipToWindow(r.points,next).filter(p=>!p.bridge).length).toBe(2);
 });
 it('does not bridge across a genuine GPS gap at midnight',()=>{
  const pts=[{latitude:1,longitude:1,segment:0,t:w.end-60},{latitude:2,longitude:2,segment:1,t:w.end+60}];
  expect(clipToWindow(pts,w).length).toBe(1);
 });
 it('looks up a position by time with no invented point inside a gap',()=>{
  const day=composeDay({date,timeZone:SYD,rows:[row('a','Drive',w.start+100,[[w.start+100,-34.5,150.9,0],[w.start+200,-34.6,150.9,0],[w.start+800,-34.9,151,1]])]});
  expect(positionAt(day,w.start+50)).toBeNull();
  expect(positionAt(day,w.start+150)).toMatchObject({point:[-34.5,150.9],inGap:false});
  expect(positionAt(day,w.start+500)).toMatchObject({point:[-34.6,150.9],inGap:true,ageSeconds:300});
  expect(positionAt(day,w.start+900)).toMatchObject({point:[-34.9,151],inGap:false});
  expect(linesUntil(day,w.start+250)).toEqual([[[-34.5,150.9],[-34.6,150.9]]]);
 });
 it('shows estimated roads separately and the live trail only on today',()=>{
  const road=encodeLine([[-34.6,150.9],[-34.8,150.95],[-34.9,151]]);
  const live={points:[[-34.9,151,w.start+900,0],[-34.91,151.01,w.start+960,0]],roads:{k:road}};
  const day=composeDay({date,timeZone:SYD,now:w.start+1000,live,rows:[row('a','Drive',w.start+100,[[w.start+100,-34.5,150.9],[w.start+200,-34.6,150.9]],{roads:{'A:1:2':road}})]});
  expect(day.estimated.length).toBe(1);expect(day.live.length).toBe(1);expect(day.liveRoads.length).toBe(1);
  expect(composeDay({date,timeZone:SYD,now:w.end+10,live,rows:[]}).live).toEqual([]);
  expect(composeDay({date,timeZone:SYD,rows:[]}).isEmpty).toBe(true);
 });
 it('fans out markers that share a spot',()=>{
  const out=spreadMarkers([1,2,3].map(n=>({n,point:[-34.5,150.9]})));
  expect(out[0].point).toEqual([-34.5,150.9]);
  expect(new Set(out.map(m=>m.point.join())).size).toBe(3);
 });
 it('handles hundreds of activities without losing the first ones',()=>{
  const rows=Array.from({length:300},(_,i)=>row('id'+i,'T'+i,w.start+i*10,[[w.start+i*10,-34.5,150.9],[w.start+i*10+5,-34.51,150.9]]));
  const day=composeDay({date,timeZone:SYD,rows});
  expect(day.markers.length).toBe(60);expect(day.markers[0].n).toBe(1);expect(day.samples.length).toBe(600);
 });
});
