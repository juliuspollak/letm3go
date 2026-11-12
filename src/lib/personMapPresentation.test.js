import {describe,it,expect} from 'vitest';
import {composeDay,linesUntil,positionAt} from './personDay.js';
import {filterPersonDay,personRoutes,recordedDistance} from './personMapPresentation.js';
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
 it('keeps disjoint saved segments disjoint and dims only unselected activities',()=>{
  const composed=day(),routes=personRoutes(composed,'drive');
  expect(routes).toHaveLength(4);
  expect(routes.filter(r=>r.activityID==='drive').every(r=>r.width===4&&r.opacity===0.65)).toBe(true);
  expect(routes.filter(r=>r.activityID==='walk').every(r=>r.width===2.5&&r.opacity===0.18)).toBe(true);
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
 expect(routes).toHaveLength(500);
 expect(routes.at(-1)).toMatchObject({activityID:'599',width:4});
});
