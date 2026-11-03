import {beforeEach,describe,expect,it} from 'vitest';
import {forgetSegmentRides,nearbySegmentLayers,segmentLibrary,segmentMatchReport,segmentRides} from './segmentRides.js';

const LAT=1/111320,LON=1/(111320*Math.cos(-34.4*Math.PI/180));
const fix=(east,t,lateral=0)=>({latitude:-34.4+lateral*LAT,longitude:150.9+east*LON,timestamp:t,accuracy:5,altitude:0,speed:5,segment:0});
// Laps of a 600 m trail at `speed` m/s, each ridden the same way, with a ride back off to the side.
function ride(id,start,speeds,title=id){
 const points=[];let t=start;
 for(const speed of speeds){
  for(let east=0;east<=600;east+=speed){points.push(fix(east,t));t+=1;}
  for(let east=600;east>=0;east-=10){points.push(fix(east,t,300));t+=1;}
 }
 return {id,title,updatedAt:start,points,details:{}};
}
function withSegment(trip,start,end,name='Rock'){
 const points=trip.points;
 return {...trip,details:{namedSegments:[{id:'s-'+name,name,startIndex:start,endIndex:end,startTimestamp:points[start].timestamp,endTimestamp:points[end].timestamp,distanceMeters:600,durationSeconds:points[end].timestamp-points[start].timestamp,colorIndex:0,updatedAt:1}]}};
}
beforeEach(forgetSegmentRides);

describe('rides through a segment',()=>{
 const today=withSegment(ride('today',1000,[6,4,5]),0,100);
 const earlier=ride('earlier',500000,[3]);
 const elsewhere={id:'elsewhere',title:'elsewhere',points:Array.from({length:200},(_,i)=>fix(i,i,5000)),details:{}};
 it('counts this ride and everywhere else',()=>{
  const [row]=segmentRides(today,[today,earlier,elsewhere]);
  expect(row).toMatchObject({name:'Rock',thisRide:3,total:4,rideCount:2,owned:true});
 });
 it('lists every pass fastest first, marking this ride',()=>{
  const {passes}=segmentRides(today,[today,earlier,elsewhere])[0];
  expect(passes.map(pass=>pass.rank)).toEqual([1,2,3,4]);
  expect(passes.at(-1)).toMatchObject({activityID:'earlier',current:false});
  expect(passes[0].current).toBe(true);
  const seconds=passes.map(pass=>{const [m,s]=pass.time.split(':').map(Number);return m*60+s;});
  expect(seconds).toEqual([...seconds].sort((a,b)=>a-b));
 });
 it('shows a segment made on another ride when this ride passed it',()=>{
  expect(segmentRides(earlier,[today,earlier])[0]).toMatchObject({thisRide:1,total:4,owned:false,ownerID:'today'});
 });
 it('leaves out segments this ride never touched',()=>{
  expect(segmentRides(elsewhere,[today,earlier,elsewhere])).toEqual([]);
 });
 it('stops counting a deleted ride',()=>{
  expect(segmentRides(today,[today])[0].total).toBe(3);
 });
 it('always counts a segment on the ride that made it',()=>{
  // Standing still: there is no line to look for elsewhere.
  const gap=withSegment({id:'gap',title:'gap',points:Array.from({length:6},(_,i)=>fix(0,i)),details:{}},0,3);
  expect(segmentRides(gap,[gap])[0]).toMatchObject({thisRide:1,total:1});
 });
 it('counts laps recorded with sparse fixes',()=>{
  const sparse=ride('sparse',800000,[40,40,40]);
  expect(segmentRides(sparse,[today,sparse])[0].thisRide).toBe(3);
 });
 it('counts three laps that each took a slightly different line',()=>{
  for(const [step,seconds] of [[5,1],[15,2],[40,5],[60,6]]){
   const points=[];let t=1000;const marks=[];
   [0,12,-14].forEach(line=>{
    for(let east=-120;east<=720;east+=step){if(line===0&&marks.length===0&&east>=0)marks.push(points.length);if(line===0&&marks.length===1&&east>=600)marks.push(points.length);points.push(fix(east,t,line));t+=seconds;}
    for(let east=720;east>=-120;east-=20){points.push(fix(east,t,300));t+=3;}
   });
   const made=withSegment({id:'laps'+step,title:'laps',updatedAt:1,points,details:{}},marks[0],marks[1]);
   expect(segmentRides(made,[made])[0].thisRide,`every ${step} m`).toBe(3);
  }
 });
 it('gives a lap seen by an automatic recording to the ride it happened in',()=>{
  const fullRide=withSegment(ride('watch',1000,[5,5,5]),0,120);
  const lastLaps=fullRide.points.filter((_,i)=>i>=250);
  const watch={...fullRide,startedAt:1000,endedAt:fullRide.points.at(-1).timestamp,recordingMode:'watch',points:fullRide.points.slice(0,250).concat(lastLaps.slice(250))};
  const automatic={id:'auto',title:'Cycling',recordingMode:'automatic',startedAt:lastLaps[0].timestamp,endedAt:lastLaps.at(-1).timestamp,updatedAt:2,points:lastLaps,details:{}};
  const seen=segmentRides(watch,[watch,automatic])[0];
  expect(seen.total).toBe(seen.thisRide);
  expect(seen.passes.every(pass=>pass.current)).toBe(true);
  const both={...fullRide,startedAt:1000,endedAt:fullRide.points.at(-1).timestamp,recordingMode:'watch'};
  const all=segmentRides(both,[both,{...automatic,points:fullRide.points}])[0];
  expect(all).toMatchObject({thisRide:3,total:3,rideCount:1});
 });
 it('still counts an automatic activity outside any recorded ride',()=>{
  const ownRide={...today,startedAt:1000,endedAt:today.points.at(-1).timestamp,recordingMode:'watch'};
  const auto={...earlier,recordingMode:'automatic',startedAt:500000,endedAt:earlier.points.at(-1).timestamp};
  expect(segmentRides(ownRide,[ownRide,auto])[0]).toMatchObject({thisRide:3,total:4,rideCount:2});
 });
 it('shows nearby segments from other rides on the map, and not distant ones',()=>{
  const layers=nearbySegmentLayers(earlier,[today,earlier]);
  expect(layers.pins).toHaveLength(1);
  expect(layers.pins[0]).toMatchObject({kind:'segment',title:'Rock'});
  expect(layers.styled.length).toBeGreaterThan(0);
  expect(nearbySegmentLayers(elsewhere,[today,elsewhere]).pins).toEqual([]);
  expect(nearbySegmentLayers(today,[today]).pins).toEqual([]);
 });
 it('lists every segment for maintenance',()=>{
  expect(segmentLibrary([today,earlier])[0]).toMatchObject({name:'Rock',activityID:'today',total:4,rideCount:2});
 });
 it('explains a result without any coordinates',()=>{
  const report=segmentMatchReport(today,[today]).join('\n');
  expect(report).toContain('3 passes');
  expect(report).not.toMatch(/-34\.|150\.9/);
 });
});
