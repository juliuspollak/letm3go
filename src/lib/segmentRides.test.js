import {beforeEach,describe,expect,it} from 'vitest';
import {forgetSegmentRides,segmentRides} from './segmentRides.js';

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
  const gap=withSegment(ride('gap',1,[5]),0,3);
  expect(segmentRides(gap,[gap])[0]).toMatchObject({thisRide:1,total:1});
 });
});
