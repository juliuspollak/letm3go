import {describe,it,expect} from 'vitest';
import {composeDay,linesUntil,positionAt} from './personDay.js';
import {filterPersonDay,personRoutes,personFlags,badgeAnchors,recordedDistance,PERSON_VERTEX_LIMIT,PERSON_ACTIVITY_LIMIT,boundedPersonLines} from './personMapPresentation.js';
const date='2026-11-10',timeZone='UTC',t=Date.parse(date+'T00:00:00Z')/1000;
const row=(id,activity,offset)=>({activity_id:id,title:id,activity,started_at:new Date((t+offset)*1000).toISOString(),ended_at:new Date((t+offset+600)*1000).toISOString(),points:[0,60,500,560].map((n,i)=>({t:t+offset+n,latitude:-34+i*0.001,longitude:151,segment:0})),roads:{}});
const day=()=>composeDay({date,timeZone,rows:[row('drive','Driving',10),row('walk','Walking',30)]});
describe('person map presentation',()=>{
 it('filters overlapping recordings without losing GPS-gap and scrub ordering',()=>{
  const filtered=filterPersonDay(day(),'Driving');
  expect(filtered.activities.map(a=>a.id)).toEqual(['drive']);
  expect(filtered.samples.map(s=>s.nextSame)).toEqual([1,2,3,-1]);
  expect(positionAt(filtered,t+200).inGap).toBe(true);
  expect(positionAt(filtered,t+200).id).toBe('drive');
  expect(linesUntil(filtered,t+580)).toHaveLength(2);
 });
 it('keeps disjoint saved segments disjoint and keeps all activities opaque with a stronger selected route',()=>{
  const composed=day(),routes=personRoutes(composed,'drive');
  expect(routes).toHaveLength(4);
  expect(routes.filter(r=>r.activityID==='drive').every(r=>r.width===4.5&&r.opacity===1)).toBe(true);
  expect(routes.filter(r=>r.activityID==='walk').every(r=>r.width===3.5&&r.opacity===1)).toBe(true);
  expect(routes[0].points).toEqual(composed.activities[0].routes[0]);
  // Two observed stretches of ~111m; the 111m silence between them is excluded.
  expect(recordedDistance(composed.activities[0])).toBeGreaterThan(220);
  expect(recordedDistance(composed.activities[0])).toBeLessThan(224);
 });
 it('returns an empty filtered day without retaining another activity or untyped live geometry',()=>{
  const composed={...day(),live:[[[1,2],[3,4]]],liveRoads:[[[1,2],[3,4]]]};
  const filtered=filterPersonDay(composed,'Cycling');
  expect(filtered).toMatchObject({isEmpty:true,activities:[],samples:[],recorded:[],estimated:[],live:[],liveRoads:[]});
  expect(filterPersonDay(composed,'')).toBe(composed);
 });
});
it('keeps a late selected activity above the bounded set of many overlapping routes',()=>{
 const activity=day().activities[0];
 const activities=Array.from({length:600},(_,i)=>({...activity,id:String(i),routes:[activity.routes[0]]}));
 const routes=personRoutes({activities},'599');
 expect(routes).toHaveLength(PERSON_ACTIVITY_LIMIT);
 expect(routes.at(-1)).toMatchObject({activityID:'599',width:4.5});
});
it('allocates across fragmented activities before adding more segments, with a bounded vertex budget',()=>{
 const base=day().activities[0];
 const long=Array.from({length:1500},(_,i)=>[-34+i*0.00001,151]);
 const activities=[{...base,id:'first',routes:Array(600).fill(long)},{...base,id:'middle',routes:[long]},{...base,id:'selected',routes:Array(600).fill(long)}];
 const routes=personRoutes({activities},'selected');
 expect(routes).toHaveLength(500);
 expect(new Set(routes.map(r=>r.activityID))).toEqual(new Set(['first','middle','selected']));
 expect(routes.filter(r=>r.activityID==='selected').length).toBe(498);
 expect(routes.reduce((n,r)=>n+r.points.length,0)).toBeLessThanOrEqual(PERSON_VERTEX_LIMIT);
 expect(routes.at(-1)).toMatchObject({activityID:'selected',width:4.5,opacity:1});
 expect(routes.every(r=>r.points[0]===long[0]&&r.points.at(-1)===long.at(-1))).toBe(true);
});
it('creates only authorised visible flags, at the original coordinates with stable chronological numbers',()=>{
 const composed=day(),filtered=filterPersonDay(composed,'Walking'),routes=personRoutes(filtered,'walk');
 expect(personFlags(filtered,routes,'walk')).toEqual([{id:'step:walk',kind:'step',point:expect.any(Array),title:'2. walk',label:'2',activityID:'walk',selected:true}]);
 expect(personFlags(composed,[],null)).toEqual([]);
});
it('uses the stronger normal style without connecting estimates and observed routes',()=>{
 const composed=day();composed.activities[0].roads=[{line:[[1,2],[3,4]]}];
 const routes=personRoutes(composed);
 expect(routes.every(r=>r.width===3.5&&r.opacity===1)).toBe(true);
 expect(routes.find(r=>r.color==='#F29927').points).toEqual([[1,2],[3,4]]);
});
it('retains an authorised single-fix start without inventing a route',()=>{
 const base=day(),single={...base.activities[0],id:'single',routes:[],roads:[]};
 const composed={...base,activities:[single],markers:[{n:1,activityID:'single',title:'Single fix',point:single.start}]};
 expect(personRoutes(composed,'single')).toEqual([]);
 expect(personFlags(composed,[],'single')[0]).toMatchObject({activityID:'single',point:single.start,selected:true});
});
it('bounds playback vertices and samples across fragmented streams while preserving separate segments',()=>{
 const lines=Array.from({length:1000},(_,i)=>Array.from({length:1000},(_,j)=>[i,j]));
 const visible=boundedPersonLines(lines);
 expect(visible).toHaveLength(750);
 expect(visible.reduce((count,line)=>count+line.length,0)).toBeLessThanOrEqual(120000);
 expect(visible[0][0]).toEqual([0,0]);expect(visible.at(-1).at(-1)).toEqual([999,999]);
});
it('keeps bounded flags and displayed activities consistent across a huge day including a late selection',()=>{
 const base=day().activities[0];
 const activities=Array.from({length:600},(_,i)=>({...base,id:String(i),routes:[base.routes[0]]}));
 const composed={activities,markers:activities.map((a,i)=>({activityID:a.id,n:i+1,title:a.id,point:a.start}))};
 const routes=personRoutes(composed,'599'),flags=personFlags(composed,routes,'599');
 expect(flags).toHaveLength(PERSON_ACTIVITY_LIMIT);
 expect(new Set(flags.map(f=>f.activityID))).toEqual(new Set(routes.map(r=>r.activityID)));
 expect(flags.at(-1)).toMatchObject({activityID:'599',label:'600',selected:true});
});
describe('numbers sit on their own line',()=>{
 const line=(lat,fromLon,toLon,n=11)=>Array.from({length:n},(_,i)=>[lat,fromLon+(toLon-fromLon)*i/(n-1)]);
 it('places a number on the line, not at the shared start',()=>{
  const l=line(-34.5,150.9,150.95);
  const anchor=badgeAnchors([l]);
  expect(anchor[0]).toBeCloseTo(-34.5,6);
  expect(anchor[1]).toBeGreaterThan(150.92);expect(anchor[1]).toBeLessThan(150.93);
 });
 it('uses the longest line of an activity',()=>{
  const anchor=badgeAnchors([line(-34.5,150.9,150.901),line(-34.6,150.9,150.95)]);
  expect(anchor[0]).toBeCloseTo(-34.6,6);
 });
 it('moves a number along its line when another number already sits there',()=>{
  const l=line(-34.5,150.9,150.95);
  const first=badgeAnchors([l]),second=badgeAnchors([l],[first]);
  expect(second).not.toEqual(first);
 });
 it('keeps trips that start at the same place from stacking their numbers',()=>{
  const base=day().activities[0];
  const a={...base,id:'a',routes:[line(-34.5,150.9,150.95)],roads:[]},b={...base,id:'b',routes:[line(-34.5,150.9,150.95)],roads:[]};
  const composed={activities:[a,b],markers:[{n:1,activityID:'a',title:'1. a',point:a.start},{n:2,activityID:'b',title:'2. b',point:b.start}]};
  const flags=personFlags(composed,personRoutes(composed,null),null);
  expect(flags.map(f=>f.label)).toEqual(['1','2']);
  expect(flags[0].point).not.toEqual(flags[1].point);
 });
 it('still marks a single-fix activity at its start',()=>{
  const base=day().activities[0],single={...base,id:'s',routes:[],roads:[]};
  const composed={activities:[single],markers:[{n:1,activityID:'s',title:'1. s',point:single.start}]};
  expect(personFlags(composed,[],null)[0].point).toEqual(single.start);
 });
});
describe('time on the map',()=>{
 it('puts each activity\'s start time on its number',()=>{
  const base=day().activities[0];
  const composed={activities:[{...base,id:'a',startedAt:Date.parse('2026-11-21T08:05:00Z')/1000,routes:[],roads:[]}],markers:[{n:1,activityID:'a',title:'1. a',point:base.start}]};
  const [flag]=personFlags(composed,[],null,'UTC');
  expect(flag.time).toBe('8:05am');expect(flag.label).toBe('1');
 });
});
