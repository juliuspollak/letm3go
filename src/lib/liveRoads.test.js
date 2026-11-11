import {beforeEach,describe,expect,it,vi} from 'vitest';
import {forgetLiveRoads,liveRoad,liveRoadWork} from './liveRoads.js';
import {gapKey,routeGaps} from './gapReconstruction.js';

const p=(lat,lon,t,segment)=>({latitude:lat,longitude:lon,timestamp:t,segment});
// A drive with a 6-minute GPS gap of about 5 km.
const trip={id:'TRIP-1',recordingMode:'automatic',activity:'Driving',state:'recording',endedAt:null,
 points:[p(-34.50,150.80,1000,0),p(-34.51,150.80,1010,0),p(-34.55,150.84,1370,1),p(-34.56,150.84,1380,1)]};
const road={distanceMeters:6500,expectedSeconds:420,points:[[-34.52,150.81],[-34.54,150.83]]};
beforeEach(forgetLiveRoads);

describe('live gap detection',()=>{
 it('finds a closed gap while recording, and finds none once the same trip is not live-checked',()=>{
  expect(routeGaps(trip,{live:true}).length).toBe(1);
  expect(routeGaps(trip).length).toBe(0); // the finished-activity path still needs a finished activity
  expect(routeGaps({...trip,state:'finished',endedAt:1400}).length).toBe(1);
 });
 it('uses the same stable key live and when finished',()=>{
  const live=gapKey(trip.id,routeGaps(trip,{live:true})[0]),done=gapKey(trip.id,routeGaps({...trip,state:'finished',endedAt:1400})[0]);
  expect(live).toBe(done);
 });
 it('does not see a gap that is still open (no fix after it yet), nor manual recordings',()=>{
  expect(routeGaps({...trip,points:trip.points.slice(0,2)},{live:true})).toEqual([]);
  expect(routeGaps({...trip,recordingMode:'manual'},{live:true})).toEqual([]);
 });
});
describe('live road work',()=>{
 it('asks Apple Maps once per gap, publishes the road, and remembers it for the finish',async()=>{
  const lookup=vi.fn().mockResolvedValue({routes:[road]}),publish=vi.fn().mockResolvedValue();
  expect(await liveRoadWork({trip,lookup,publish})).toHaveLength(1);
  expect(await liveRoadWork({trip,lookup,publish})).toHaveLength(0);
  expect(lookup).toHaveBeenCalledTimes(1);expect(publish).toHaveBeenCalledTimes(1);
  expect(publish.mock.calls[0][0]).toBe('TRIP-1');
  expect(liveRoad(gapKey(trip.id,routeGaps(trip,{live:true})[0])).status).toBe('route');
 });
 it('rejects an implausible route: nothing is published, and it is not asked again',async()=>{
  const lookup=vi.fn().mockResolvedValue({routes:[{...road,distanceMeters:60000}]}),publish=vi.fn();
  await liveRoadWork({trip,lookup,publish});await liveRoadWork({trip,lookup,publish});
  expect(publish).not.toHaveBeenCalled();expect(lookup).toHaveBeenCalledTimes(1);
 });
 it('retries a failed lookup only after its back-off, and never publishes it',async()=>{
  const lookup=vi.fn().mockRejectedValue(new Error('network')),publish=vi.fn();
  await liveRoadWork({trip,lookup,publish,now:1000});
  await liveRoadWork({trip,lookup,publish,now:1100});
  expect(lookup).toHaveBeenCalledTimes(1);
  await liveRoadWork({trip,lookup,publish,now:1000+11*60000});
  expect(lookup).toHaveBeenCalledTimes(2);expect(publish).not.toHaveBeenCalled();
 });
 it('never asks for more than a few roads in one pass',async()=>{
  const points=[];for(let i=0;i<10;i++)points.push(p(-34.5-i*0.05,150.8,1000+i*400,i),p(-34.52-i*0.05,150.8,1010+i*400,i));
  const lookup=vi.fn().mockResolvedValue({routes:[]});
  expect((await liveRoadWork({trip:{...trip,points},lookup,publish:vi.fn()})).length).toBeLessThanOrEqual(3);
 });
 it('treats a road already held by the saved metadata as answered',async()=>{
  const lookup=vi.fn();
  await liveRoadWork({trip,lookup,publish:vi.fn(),held:()=>({status:'route',line:'abc'})});
  expect(lookup).not.toHaveBeenCalled();
 });
});
