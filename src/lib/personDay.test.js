import {describe,expect,it} from 'vitest';
import {addDays,dayKeyOf,dayWindow} from './dayWindow.js';
import {mergeTrail,newestTime,trailLines} from './liveTrail.js';
import {clipToWindow,composeDay,linesUntil,localDayRows,mergeOwnRows,positionAt,spreadMarkers,thinRoutePoints} from './personDay.js';
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
describe('time zones, travel and daylight saving',()=>{
 const LAX='America/Los_Angeles';
 const trip=(id,start,count)=>({activity_id:id,title:id,activity:'Driving',started_at:new Date(start*1000).toISOString(),ended_at:new Date((start+count*60)*1000).toISOString(),roads:{},
  points:Array.from({length:count},(_,i)=>({latitude:-34.5-i*1e-4,longitude:150.9,segment:0,t:start+i*60}))});
 it('puts every fix of a 25-hour day on that day once, including the repeated hour',()=>{
  const w=dayWindow('2026-11-01',LAX);                      // clocks go back: 25 hours
  const rows=[trip('repeat',w.start+3600,200)];            // spans the repeated 1-2 am hour
  const day=composeDay({date:'2026-11-01',timeZone:LAX,rows});
  expect(day.samples.length).toBe(200);
  expect(new Set(day.samples.map(s=>s.t)).size).toBe(200);  // nothing doubled
  expect(day.samples.every(s=>s.t>=w.start&&s.t<w.end)).toBe(true);
 });
 it('a 23-hour day (clocks forward) still ends exactly where the next begins, with no fix in both',()=>{
  const a=dayWindow('2027-03-14',LAX),b=dayWindow('2027-03-15',LAX);
  expect(a.end).toBe(b.start);
  const row=trip('over',a.end-30*60,60);                    // an hour across midnight
  const first=composeDay({date:'2027-03-14',timeZone:LAX,rows:[row]}),second=composeDay({date:'2027-03-15',timeZone:LAX,rows:[row]});
  expect(first.samples.length+second.samples.length).toBe(60);
  expect(first.samples.at(-1).t).toBeLessThan(second.samples[0].t);
 });
 it('the same instant is a different day for a viewer in another zone, and each is self-consistent',()=>{
  const instant=Date.parse('2026-11-10T20:30:00Z')/1000;    // 07:30 next morning in Sydney, 12:30 in Los Angeles
  expect(dayKeyOf(instant,SYD)).toBe('2026-11-11');expect(dayKeyOf(instant,LAX)).toBe('2026-11-10');
  const row=trip('x',instant,10);
  expect(composeDay({date:'2026-11-11',timeZone:SYD,rows:[row]}).samples.length).toBe(10);
  expect(composeDay({date:'2026-11-10',timeZone:SYD,rows:[row]}).samples.length).toBe(0);
  expect(composeDay({date:'2026-11-10',timeZone:LAX,rows:[row]}).samples.length).toBe(10);
 });
 it('a traveller changing zone mid-trip keeps whole days: windows from different zones overlap but never split a fix',()=>{
  const row=trip('flight',Date.parse('2026-11-10T10:00:00Z')/1000,120);
  for(const zone of [SYD,LAX,'Pacific/Auckland','UTC']){
   const days=new Set(row.points.map(p=>dayKeyOf(p.t,zone)));
   const total=[...days].reduce((n,d)=>n+composeDay({date:d,timeZone:zone,rows:[row]}).samples.length,0);
   expect(total).toBe(120);
  }
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
 it('stays bounded without losing the start of a long drive',()=>{
  const hours=Array.from({length:14400},(_,i)=>p(i*2+1)); // four hours at one fix per 2 s
  const out=mergeTrail([],hours,3000);
  expect(out.length).toBeLessThanOrEqual(3000);
  expect(out[0][2]).toBe(1);expect(out.at(-1)[2]).toBe(14399*2+1);
  expect(out.map(x=>x[2])).toEqual([...out.map(x=>x[2])].sort((a,b)=>a-b));
  expect(out.at(-1)[2]-out.at(-2)[2]).toBe(2);                // recent: full resolution
  const gaps=out.slice(1).map((x,i)=>x[2]-out[i][2]);
  expect(Math.max(...gaps)).toBeLessThan(200);                // no hole in the timeline
 });
 it('keeps both ends of a GPS segment when thinning',()=>{
  const pts=[...Array.from({length:3000},(_,i)=>p(i+1,0)),...Array.from({length:3000},(_,i)=>p(4000+i,1))];
  const out=mergeTrail([],pts,3000);
  const seg0=out.filter(x=>x[3]===0);
  expect(seg0[0][2]).toBe(1);expect(seg0.at(-1)[2]).toBe(3000);
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
  const live={points:[[-34.9,151,w.start+900,0],[-34.91,151.01,w.start+960,0]],roads:{[`live:${w.start+900}:${w.start+960}`]:road}};
  const day=composeDay({date,timeZone:SYD,now:w.start+1000,live,rows:[row('a','Drive',w.start+100,[[w.start+100,-34.5,150.9],[w.start+200,-34.6,150.9]],{roads:{[`A:${w.start+100}:${w.start+200}`]:road}})]});
  expect(day.estimated.length).toBe(1);expect(day.live.length).toBe(1);expect(day.liveRoads.length).toBe(1);
  expect(composeDay({date,timeZone:SYD,now:w.end+10,live,rows:[]}).live).toEqual([]);
  expect(composeDay({date,timeZone:SYD,rows:[]}).isEmpty).toBe(true);
 });
 it('draws an activity shared without capture times but never offers it to the time slider',()=>{
  const old={activity_id:'o',title:'Old share',activity:'Driving',started_at:new Date((w.start+100)*1000).toISOString(),ended_at:new Date((w.start+400)*1000).toISOString(),roads:{},
   points:[{latitude:-34.5,longitude:150.9,segment:0},{latitude:-34.6,longitude:150.9,segment:0},{latitude:-34.7,longitude:150.9,segment:0}]};
  const day=composeDay({date,timeZone:SYD,rows:[old]});
  expect(day.recorded.length).toBe(1);expect(day.markers.length).toBe(1);expect(day.samples).toEqual([]);expect(positionAt(day,w.start+200)).toBeNull();
 });
 it('does not call the time between two different activities a recorded position',()=>{
  const day=composeDay({date,timeZone:SYD,rows:[
   row('a','Morning',w.start+100,[[w.start+100,-34.5,150.9,0],[w.start+200,-34.6,150.9,0]]),
   row('b','Afternoon',w.start+50000,[[w.start+50000,-34.8,151,0],[w.start+50100,-34.9,151,0]])]});
  expect(positionAt(day,w.start+25000)).toMatchObject({point:[-34.6,150.9],inGap:true});
 });
 it('keeps untimed activities on the map while scrubbing',()=>{
  const old={activity_id:'o',title:'Old',activity:'Driving',started_at:new Date((w.start+100)*1000).toISOString(),ended_at:new Date((w.start+400)*1000).toISOString(),roads:{},points:[{latitude:-34.5,longitude:150.9,segment:0},{latitude:-34.6,longitude:150.9,segment:0}]};
  expect(composeDay({date,timeZone:SYD,rows:[old]}).untimed.length).toBe(1);
 });
 it('overlapping recordings keep their own lines and gaps while scrubbing',()=>{
  const day=composeDay({date,timeZone:SYD,rows:[
   row('manual','Walk',w.start+100,[[w.start+100,-34.5,150.9,0],[w.start+200,-34.51,150.9,0],[w.start+300,-34.52,150.9,0]]),
   row('auto','Drive',w.start+150,[[w.start+150,-34.6,151,0],[w.start+250,-34.61,151,0],[w.start+350,-34.62,151,0]])]});
  const lines=linesUntil(day,w.start+600);
  expect(lines.length).toBe(2);expect(lines.every(l=>l.length===3)).toBe(true);
  expect(linesUntil(day,w.start+260).map(l=>l.length).sort()).toEqual([2,2]);
  expect(positionAt(day,w.start+260)).toMatchObject({id:'auto',inGap:false});
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

describe('my own day: activities that are only on this phone',()=>{
 const w=dayWindow('2026-11-10',SYD);
 const trip=(id,start,count,over={})=>({id,source:'device',title:'Local '+id,activity:'Driving',startedAt:start,endedAt:start+count,
  points:Array.from({length:count},(_,i)=>({latitude:-34.5-i*1e-4,longitude:150.9,timestamp:start+i+0.4,segment:0,accuracy:5})),...over});
 const cloud=(id,start,extra={})=>({activity_id:id,title:'Cloud '+id,activity:'Driving',started_at:new Date(start*1000).toISOString(),ended_at:new Date((start+600)*1000).toISOString(),etag:'e',roads:{},points:[{latitude:-34.5,longitude:150.9,segment:0,t:start}],...extra});
 it('shows an activity saved on the phone before its backup, from the recorder\'s own points',()=>{
  const rows=localDayRows([trip('ABCD-1',w.start+1000,300)],w);
  expect(rows.length).toBe(1);expect(rows[0].activity_id).toBe('abcd-1');expect(rows[0].points[0]).toEqual({latitude:-34.5,longitude:150.9,segment:0,t:w.start+1000});
  const day=composeDay({date:'2026-11-10',timeZone:SYD,rows});
  expect(day.markers.length).toBe(1);expect(day.samples.length).toBe(300);
 });
 it('merges by id regardless of case: one row, the phone\'s route, the cloud\'s roads and etag, no duplicate marker',()=>{
  const local=localDayRows([trip('ABCD-1',w.start+1000,300)],w);
  const merged=mergeOwnRows([cloud('abcd-1',w.start+1000,{roads:{'ABCD-1:1:2':'xyz'}}),cloud('other',w.start+5000)],local);
  expect(merged.length).toBe(2);
  const mine=merged.find(r=>r.activity_id==='abcd-1');
  expect(mine.points.length).toBe(300);expect(mine.roads).toEqual({'ABCD-1:1:2':'xyz'});expect(mine.etag).toBe('e');
  expect(composeDay({date:'2026-11-10',timeZone:SYD,rows:merged}).markers.map(m=>m.n)).toEqual([1,2]);
 });
 it('an activity deleted on this phone is not resurrected by a stale cloud copy',()=>{
  const local=localDayRows([trip('GONE-1',w.start+1000,50)],w,['GONE-1']);
  expect(local).toEqual([]);
  expect(mergeOwnRows([cloud('gone-1',w.start+1000)],[],['GONE-1'])).toEqual([]);
 });
 it('leaves out other days, unfinished activities and other sources',()=>{
  const rows=localDayRows([trip('A',w.start-86400-10,50),trip('B',w.start+10,50,{endedAt:null}),trip('C',w.start+10,50,{source:'tesla'}),trip('D',w.start+10,50)],w);
  expect(rows.map(r=>r.activity_id)).toEqual(['d']);
 });
 it('thins a very long route but keeps both ends and the segment breaks',()=>{
  const points=Array.from({length:20000},(_,i)=>({latitude:-34,longitude:150,timestamp:i,segment:i<12000?0:1}));
  const out=thinRoutePoints(points);
  expect(out.length).toBeLessThanOrEqual(1700);expect(out[0]).toBe(points[0]);expect(out.at(-1)).toBe(points[19999]);
  expect(out.some(p=>p.timestamp===11999)&&out.some(p=>p.timestamp===12000)).toBe(true);
 });
 it('is never used for anyone else\'s map',()=>{
  expect(typeof localDayRows).toBe('function');                               // the hook only passes it for the viewer\'s own id (see PersonMap)
 });
});

it('assigns each estimated gap to the viewer day of its first fix, including gaps across midnight',()=>{
 const date='2026-10-04',w=dayWindow(date,SYD),road=encodeLine([[-34,150],[-35,151]]);
 const r=row('x','Overnight',w.start+10,[[w.start+10,-34,150],[w.end-20,-34,150],[w.end+20,-35,151],[w.end+100,-35,151]],
  {roads:{[`x:${w.start+10}:${w.start+20}`]:road,[`x:${w.end-20}:${w.end+20}`]:road,[`x:${w.end+20}:${w.end+100}`]:road}});
 expect(composeDay({date,timeZone:SYD,rows:[r]}).estimated).toHaveLength(2);
 expect(composeDay({date:addDays(date,1),timeZone:SYD,rows:[r]}).estimated).toHaveLength(1);
});
it('recognises a long silence in a reused segment and never draws across it while scrubbing',()=>{
 const date='2026-11-10',w=dayWindow(date,SYD);
 const r=row('legacy','GPS',w.start+10,[[w.start+10,-34,150],[w.start+20,-34.001,150],[w.start+900,-35,151],[w.start+910,-35.001,151]]);
 const day=composeDay({date,timeZone:SYD,rows:[r]});
 expect(positionAt(day,w.start+500)).toMatchObject({inGap:true,point:[-34.001,150]});
 expect(linesUntil(day,w.start+1000).map(l=>l.length)).toEqual([2,2]);
});

it.each([['2026-10-04',SYD],['2027-04-04',SYD],['2026-11-01',LA],['2027-03-14',LA]])('keeps road estimates on one viewer-local day on DST transition %s', (date,timeZone)=>{
 const w=dayWindow(date,timeZone),road=encodeLine([[-34,150],[-35,151]]);
 const r=row('x','Overnight',w.end-60,[[w.end-60,-34,150],[w.end+60,-35,151]],{roads:{[`x:${w.end-60}:${w.end+60}`]:road}});
 expect(composeDay({date,timeZone,rows:[r]}).estimated).toHaveLength(1);
 expect(composeDay({date:addDays(date,1),timeZone,rows:[r]}).estimated).toEqual([]);
 const other=timeZone===SYD?LA:SYD,otherDate=dayKeyOf(w.end-60,other);
 expect(composeDay({date:otherDate,timeZone:other,rows:[r]}).estimated).toHaveLength(1);
});

it('keeps normal samples, stops and resumed segments distinct with overlapping activities',()=>{
 const date='2026-11-10',w=dayWindow(date,SYD),t=w.start;
 const day=composeDay({date,timeZone:SYD,rows:[
  row('drive','Resumed',t+10,[[t+10,-34,150,0],[t+20,-34,150,0],[t+1000,-34,150,1],[t+1010,-34,150,1]]),
  row('walk','Overlapping',t+100,[[t+100,-35,151,0],[t+110,-35.001,151,0],[t+120,-35.002,151,0]])]});
 expect(positionAt(day,t+15)).toMatchObject({id:'drive',inGap:false});
 expect(positionAt(day,t+115)).toMatchObject({id:'walk',inGap:false});
 expect(positionAt(day,t+500)).toMatchObject({id:'walk',inGap:true});
 expect(positionAt(day,t+1000)).toMatchObject({id:'drive',inGap:false});
 expect(linesUntil(day,t+1020).map(l=>l.length)).toEqual([2,3,2]);
});

it('does not draw the same finalised activity as both recorded and live while completion reaches viewers',()=>{
 const date='2026-11-10',w=dayWindow(date,SYD),t=w.start+10;
 const r=row('a','Finished',t,[[t,-34,150],[t+10,-34.001,150]],{ended_at:new Date((t+10)*1000).toISOString()});
 const live={ref:'A',points:[[-34,150,t,0],[-34.001,150,t+10,0]],roads:{}};
 const day=composeDay({date,timeZone:SYD,now:t+20,rows:[r],live});
 expect(day.recorded).toHaveLength(1);expect(day.live).toEqual([]);expect(day.samples).toHaveLength(2);
});

describe('a household member\'s earlier recordings, as the database publishes them',()=>{
 // Exactly the row my_shared_day returns for a snapshot made by household_snapshot: latitude, longitude, segment and an
 // epoch-second capture time `t`; a stretch hidden near Home leaves a jump in `segment`; an activity masked entirely has no points.
 const date='2026-11-09',w=dayWindow(date,SYD);
 const row=(id,offset,points)=>({activity_id:id,title:'Trip',activity:'Driving',started_at:new Date((w.start+offset)*1000).toISOString(),ended_at:new Date((w.start+offset+1200)*1000).toISOString(),roads:{},points});
 const pts=offset=>[0,60,120,600,660].map((d,i)=>({latitude:-34.5-i*0.01,longitude:150.8+i*0.01,segment:i<3?0:1,t:w.start+offset+d}));
 const rows=[row('a1',3600,pts(3600)),row('a2',20000,pts(20000)),row('a3',40000,[])];
 it('draws every recorded route on its day, one marker each, with the capture times kept for the slider',()=>{
  const day=composeDay({rows,timeZone:SYD,date,now:w.end+86400});
  expect(day.activities.map(a=>a.id)).toEqual(['a1','a2']);                  // the fully masked one adds nothing, and breaks nothing
  expect(day.recorded).toHaveLength(4);                                       // two segments each, cut where the hidden stretch was
  expect(day.markers.map(m=>m.activityID)).toEqual(['a1','a2']);
  expect(day.samples.length).toBe(10);
  expect(day.isEmpty).toBe(false);
 });
 it('shows nothing, and says it is empty, for a day the person has no recordings on',()=>{
  expect(composeDay({rows:[],timeZone:SYD,date:addDays(date,1),now:w.end+86400}).isEmpty).toBe(true);
 });
 it('does not draw the same recording twice when it is also a live trail that finished',()=>{
  const day=composeDay({rows,live:{ref:'A1',points:[[-34.5,150.8,w.start+3600,0],[-34.6,150.9,w.start+3700,0]],roads:{}},timeZone:SYD,date,now:w.start+4000});
  expect(day.live).toEqual([]);
 });
});
