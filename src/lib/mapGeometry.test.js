import {expect,it} from 'vitest';
import {displaySegments,recordedRouteSegments,displayMetres} from './mapGeometry.js';
const origin=[-34.56,150.86],cos=Math.cos(origin[0]*Math.PI/180);
const at=(x,y=0)=>[origin[0]+y/111320,origin[1]+x/(111320*cos)];
it('limits dense map geometry without joining pause gaps or mutating native points',()=>{
 const first=Array.from({length:5000},(_,i)=>at(i)),second=Array.from({length:5000},(_,i)=>at(i,200));
 const trip={routeSegments:[first,second]},before=JSON.stringify(trip),result=displaySegments(trip);
 expect(result.flat().length).toBeLessThanOrEqual(2004);
 expect(result[0][0]).toEqual(first[0]);expect(result[0].at(-1)).toEqual(first.at(-1));expect(result[1][0]).toEqual(second[0]);
 expect(JSON.stringify(trip)).toBe(before);
});
it('keeps a real corner that falls between the old stride ticks',()=>{
 const route=[...Array.from({length:60},(_,i)=>at(i)),at(60),...Array.from({length:60},(_,i)=>at(60,i+1))];
 const result=displaySegments({route},6)[0];
 expect(result).toContainEqual(at(60));expect(result[0]).toEqual(route[0]);expect(result.at(-1)).toEqual(route.at(-1));
});
it('simplifies sub-metre drift on a long straight road without moving any retained observations',()=>{
 const route=Array.from({length:6000},(_,i)=>at(i,(i%2?1:-1)*0.4));
 const result=displaySegments({route},200)[0];
 expect(result.length).toBeLessThanOrEqual(200);
 for(const point of result)expect(route.includes(point)).toBe(true);
 expect(Math.max(...result.map(p=>Math.abs((p[0]-origin[0])*111320)))).toBeLessThan(0.41);
});
it('splits invalid and implausibly distant stretches before any sampling can erase the break',()=>{
 const a=at(0),b=at(10),c=at(20),d=at(30),far=at(4000);
 expect(displaySegments({route:[a,b,null,c,d]},3)).toEqual([[a,b],[c,d]]);
 expect(displaySegments({route:[a,b,far,at(4010)]})).toEqual([[a,b],[far,at(4010)]]);
});
it('keeps sparse, curved, walking and cycling shapes where no point budget is needed',()=>{
 const curve=Array.from({length:80},(_,i)=>at(100*Math.sin(i/79),100*(1-Math.cos(i/79))));
 for(const activity of ['Walking','Cycling','Driving'])expect(displaySegments({activity,route:curve})).toEqual([curve]);
 expect(displaySegments({route:[at(0),at(1200),at(1900)]})).toHaveLength(1);
});
const observation=(x,t,extra={})=>({latitude:at(x)[0],longitude:at(x)[1],timestamp:t,segment:0,accuracy:5,...extra});
it('uses chronological runs even when a historical recording reuses segment IDs',()=>{
 const points=[observation(0,0),observation(10,5),observation(20,10,{segment:1}),observation(30,15,{segment:1}),observation(40,20),observation(50,25)];
 expect(recordedRouteSegments(points)).toEqual([[at(0),at(10)],[at(20),at(30)],[at(40),at(50)]]);
});
it('excludes low-accuracy observations without bridging them or changing the raw record',()=>{
 const points=[observation(0,0),observation(10,5),observation(150,10,{accuracy:120}),observation(20,15),observation(30,20)];
 const before=JSON.stringify(points);
 expect(recordedRouteSegments(points)).toEqual([[at(0),at(10)],[at(20),at(30)]]);expect(JSON.stringify(points)).toBe(before);
});
it('honours automatic stationary stops, watch/manual gaps, timestamps and genuine signal interruptions',()=>{
 expect(recordedRouteSegments([observation(0,0),observation(10,60)],{automatic:true})).toHaveLength(1);
 expect(recordedRouteSegments([observation(0,0),observation(100,60)],{automatic:true})).toHaveLength(2);
 expect(recordedRouteSegments([observation(0,0),observation(10,60)])).toHaveLength(2);
 expect(recordedRouteSegments([observation(0,0),observation(10,5),observation(8,3),observation(20,10),observation(30,15)])).toEqual([[at(0),at(10)],[at(20),at(30)]]);
 expect(recordedRouteSegments([observation(0,0),observation(1000,1),observation(20,2)])).toHaveLength(3);
});
it('does not turn stationary drift into extra traversed movement or invent a smoother road',()=>{
 const points=Array.from({length:12},(_,i)=>observation(i%2,5*i));
 const result=recordedRouteSegments(points);
 expect(result.flat()).toEqual(points.map(p=>[p.latitude,p.longitude]));
 expect(displayMetres(result[0][0],result[0].at(-1))).toBeLessThan(1.01);
});
it('treats a point budget as soft rather than flattening genuine dense bends',()=>{
 const route=Array.from({length:600},(_,i)=>at(i*5,i%2?5:0));
 const before=JSON.stringify(route),result=displaySegments({route},10).flat();
 expect(result.length).toBeGreaterThan(10);
 for(const p of result)expect(route.includes(p)).toBe(true);
 expect(JSON.stringify(route)).toBe(before);
});
it('keeps the separately defined sparse Fleet telemetry cadence rather than imposing the phone sampling window',()=>{
 const points=[observation(0,0),observation(100,60),observation(200,120)];
 expect(recordedRouteSegments(points,{fleet:true})).toEqual([[at(0),at(100),at(200)]]);
 expect(recordedRouteSegments([observation(0,0),observation(100,121)],{fleet:true})).toHaveLength(2);
});
