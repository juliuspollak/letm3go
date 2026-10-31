import {describe,expect,it} from 'vitest';
import {DENSITY_CELLS,densityBucket,densityKey,edgePoints,journeyEdges,routeDensity,routeSignature} from './routeDensity.js';
import {highlightRoutes,mapOverview,overviewPhotos} from './mapOverview.js';
import {mapPayload} from './appleMaps.js';

// A straight street in Sydney, north to south, sampled every ~20 m.
const street=(offsetMetres=0,step=0.00018,count=40,lon=151.2)=>Array.from({length:count},(_,i)=>[-33.86-i*step,lon+offsetMetres/92000]);
const journey=(id,route,extra={})=>({id,routeSegments:[route],startedAt:1_700_000_000+Number(String(id).replace(/\D/g,'')||0),...extra});
const lines=(level)=>level.buckets.flatMap(b=>b.lines);
const weightAt=(level,point)=>{
 let best=null;
 for(const bucket of level.buckets)for(const line of bucket.lines)for(const p of line)if(Math.abs(p[0]-point[0])<0.0004&&Math.abs(p[1]-point[1])<0.0004)best=Math.max(best??0,bucket.weight);
 return best;
};

describe('route density',()=>{
 it('is deterministic, whatever order the journeys arrive in',()=>{
  const journeys=[journey('a1',street()),journey('b2',street(3).reverse()),journey('c3',street(0,0.00018,40,151.25))];
  const first=routeDensity(journeys),again=routeDensity([...journeys].reverse());
  expect(again).toEqual(first);
  expect(first.levels.map(level=>level.cell)).toEqual(DENSITY_CELLS);
 });
 it('aggregates overlapping journeys despite GPS jitter, sampling and direction',()=>{
  // The same street ridden twice: once north to south, once back with 3 m of
  // jitter and half the fixes. Another street only once.
  const jittered=street(3).filter((_,i)=>i%2===0).reverse();
  const density=routeDensity([journey('a1',street()),journey('b2',jittered),journey('c3',street(0,0.00018,40,151.25))]);
  const fine=density.levels[0];
  expect(fine.maxCount).toBe(2);
  expect(weightAt(fine,[-33.863,151.2])).toBeGreaterThan(weightAt(fine,[-33.863,151.25]));
  // Same edges whichever way the street was travelled.
  expect(journeyEdges([street().reverse()],25)).toEqual(journeyEdges([street()],25));
 });
 it('keeps a route travelled once visible but subtle',()=>{
  const density=routeDensity([journey('a1',street())]);
  expect(lines(density.levels[0]).length).toBeGreaterThan(0);
  expect(density.levels[0].buckets.map(b=>b.weight)).toEqual([1]);
  expect(densityBucket(1,500)).toBe(1);
  expect(densityBucket(500,500)).toBe(5);
  expect(densityBucket(2,2)).toBeLessThan(5);
 });
 it('counts a journey once per street, even when it loops back over it',()=>{
  const loop=[...street(),...street().reverse(),...street()];
  const once=routeDensity([journey('a1',street())]),looped=routeDensity([journey('a1',loop)]);
  expect(looped.levels[0].maxCount).toBe(1);
  expect(lines(looped.levels[0]).flat().length).toBeGreaterThan(0);
  expect(looped.levels[0].buckets.map(b=>b.weight)).toEqual(once.levels[0].buckets.map(b=>b.weight));
 });
 it('chains edges into a few long lines instead of thousands of overlays',()=>{
  const density=routeDensity([journey('a1',street(0,0.00018,400))]);
  expect(lines(density.levels[0])).toHaveLength(1);
  expect(lines(density.levels[0])[0].length).toBeGreaterThan(100);
 });
 it('never draws a straight line across a GPS gap',()=>{
  const gap=[[-33.86,151.2],[-33.861,151.2],[-34.2,151.2],[-34.201,151.2]];
  const lats=[...journeyEdges([gap],25)].flatMap(edge=>edgePoints(edge,25).map(p=>p[0]));
  // Both 110 m halves are drawn; nothing in the 37 km between them.
  expect(lats.some(lat=>lat>-33.862)).toBe(true);
  expect(lats.some(lat=>lat<-34.199)).toBe(true);
  expect(lats.filter(lat=>lat<-33.87&&lat>-34.19)).toEqual([]);
 });
 it('handles empty routes, missing and invalid points without inventing anything',()=>{
  const density=routeDensity([{id:'empty'},journey('nulls',[[NaN,1],[0,0],[200,1],null,[1]]),journey('single',[[-33.86,151.2]])]);
  expect(density.levels.every(level=>level.buckets.length===0)).toBe(true);
  expect(density.total).toBe(0);
  expect(density.included).toBe(0);
  expect(density.focus).toBeNull();
  expect(routeDensity([])).toMatchObject({total:0,included:0});
 });
 it('says when only the most recent journeys fit the budget',()=>{
  const journeys=Array.from({length:6},(_,i)=>journey(`j${i}`,street(0,0.00018,40,151.2+i*0.01),{startedAt:1000+i}));
  const density=routeDensity(journeys,{budget:100});
  expect(density.total).toBe(6);
  expect(density.included).toBe(2);
 });
 it('drops a grid that is too detailed and keeps the coarser ones',()=>{
  const density=routeDensity([journey('a1',street(0,0.00018,400))],{edgeLimit:100});
  expect(density.levels.map(level=>level.cell)).not.toContain(25);
  expect(density.levels.length).toBeGreaterThan(0);
 });
 it('frames where the routes mostly are, not a single far-away trip',()=>{
  const home=Array.from({length:30},(_,i)=>journey(`h${i}`,street(0,0.00018,60,151.2+i*0.02)));
  const away=journey('far',street(0,0.00018,60,-0.12).map(([lat,lon])=>[lat+85,lon]));
  const {focus}=routeDensity([...home,away]);
  expect(focus[0]).toBeLessThan(-33);
  expect(focus[2]).toBeLessThan(0);
 });
 it('keys the data by journeys, so it is sent to the map once per change',()=>{
  const a=[journey('a1',street())];
  expect(densityKey(a)).toBe(densityKey([journey('a1',street())]));
  expect(densityKey(a)).not.toBe(densityKey([journey('a1',street(0,0.00018,41))]));
 });
});

describe('overview photos and highlight routes',()=>{
 const trip=journey('trip-1',street(),{title:'Morning ride',activity:'Cycling',distance:4.2,date:'2026-10-27',startedAt:1_793_000_000,photos:[{id:'p1',point:[-33.861,151.2],caption:'Harbour'},{id:'p2',point:[-33.862,151.2]},{id:'bad',point:[NaN,1]}]});
 const noRoute=journey('trip-2',[[-33.9,151.1]],{activity:'Walking',photos:[{id:'p3',point:[-33.9,151.1]}]});
 it('ties every photo to its own journey, with only the details that are known',()=>{
  const photos=overviewPhotos([trip,noRoute]);
  expect(photos.map(p=>[p.photoID,p.journeyID])).toEqual([['p1','trip-1'],['p2','trip-1'],['p3','trip-2']]);
  expect(photos[0]).toMatchObject({kind:'photo',title:'Harbour',journeyTitle:'Morning ride',journeyDistance:'4.2 km'});
  expect(photos[0].journeyDate).toMatch(/2026/);
  // Unknown distance and title are left out, never guessed.
  expect(photos[2]).not.toHaveProperty('journeyDistance');
  expect(photos[2].journeyTitle).toBe('Walking');
 });
 it('highlights exactly the photo journey route, and nothing for a journey without one',()=>{
  const photos=overviewPhotos([trip,noRoute]);
  const routes=highlightRoutes([trip,noRoute],photos);
  expect(Object.keys(routes)).toEqual(['trip-1']);
  expect(routes['trip-1']).toEqual([street().map(([lat,lon])=>[Math.round(lat*1e5)/1e5,Math.round(lon*1e5)/1e5])]);
 });
 it('changes its key when a journey is renamed or gets a photo',()=>{
  const key=mapOverview([trip]).key;
  expect(mapOverview([trip]).key).toBe(key);
  expect(mapOverview([{...trip,title:'Evening ride'}]).key).not.toBe(key);
  expect(mapOverview([{...trip,photos:[...trip.photos,{id:'p9',point:[-33.86,151.2]}]}]).key).not.toBe(key);
 });
 it('sends no Start/Finish pins, lines or photos with an overview, but keeps them on a single journey map',()=>{
  const people=[{kind:'people',point:[-33.87,151.21],members:[{id:'self'}]}];
  const overview=mapPayload([trip],null,null,[],people,{overview:'d123'});
  expect(overview).toEqual({routes:[],gaps:[],pins:people,overview:'d123'});
  const detail=mapPayload([trip]);
  expect(detail.pins.map(p=>p.kind)).toEqual(['start','finish','photo','photo']);
  expect(detail.routes).toHaveLength(1);
 });
});

describe('cache invalidation',()=>{
 const photos=[{id:'p',point:[-33.86,151.2]}];
 it('never reuses edges or highlight geometry when points move but their count does not',()=>{
  const before={id:'j',startedAt:1,routeSegments:[street()],photos};
  const after={id:'j',startedAt:1,routeSegments:[street(0,0.00018,40,151.3)],photos};
  expect(densityKey([after])).not.toBe(densityKey([before]));
  expect(routeDensity([after]).levels[0]).not.toEqual(routeDensity([before]).levels[0]);
  const first=mapOverview([before]),second=mapOverview([after]);
  expect(second.key).not.toBe(first.key);
  expect(second.routes.j[0][0][1]).toBeCloseTo(151.3,4);
 });
 it('notices a single moved point, and a trimmed (visible range) change',()=>{
  const route=street();
  const moved=route.map((p,i)=>i===20?[p[0],p[1]+0.001]:p);
  expect(routeSignature({routeSegments:[moved]})).not.toBe(routeSignature({routeSegments:[route]}));
  expect(routeSignature({routeSegments:[route.slice(1)]})).not.toBe(routeSignature({routeSegments:[route]}));
  // The same route content gives the same key, so nothing is resent.
  expect(routeSignature({routeSegments:[route.map(p=>[...p])]})).toBe(routeSignature({routeSegments:[route]}));
 });
 it('hashes a route once per route array, not on every render',()=>{
  const segments=[street()];
  const journey={id:'j',routeSegments:segments};
  const first=routeSignature(journey);
  segments[0][3]=[0,0]; // mutation is not how journeys change; the cached value stands
  expect(routeSignature(journey)).toBe(first);
 });
});

describe('invalid samples and gaps',()=>{
 const A=[-33.86,151.2],B=[-33.8605,151.2],C=[-33.8695,151.2],D=[-33.87,151.2];
 const lats=(segments,size=25)=>[...journeyEdges(segments,size)].flatMap(edge=>edgePoints(edge,size).map(p=>p[0]));
 for(const [name,bad] of [['NaN',[NaN,151.2]],['null',null],['missing longitude',[-33.865]],['0,0',[0,0]],['out of range',[-133,151.2]],['strings',['x','y']]]){
  it(`never joins valid points across a ${name} sample`,()=>{
   const crossed=lats([[A,B,bad,C,D]]);
   // Both short stretches are kept; nothing between them is invented.
   expect(crossed.some(lat=>lat>-33.8606)).toBe(true);
   expect(crossed.some(lat=>lat<-33.8694)).toBe(true);
   expect(crossed.filter(lat=>lat<-33.8612&&lat>-33.8688)).toEqual([]);
  });
 }
 it('never joins separate recorded segments',()=>{
  const separate=lats([[A,B],[C,D]]);
  expect(separate.filter(lat=>lat<-33.8612&&lat>-33.8688)).toEqual([]);
 });
 it('keeps a legitimately sparse recording continuous',()=>{
  // A drive sampled every ~1.1 km (fast, infrequent fixes) is one line.
  const sparse=Array.from({length:6},(_,i)=>[-33.86-i*0.01,151.2]);
  const density=routeDensity([{id:'drive',routeSegments:[sparse]}]);
  const line=density.levels.find(l=>l.cell===100).buckets.flatMap(b=>b.lines);
  expect(line).toHaveLength(1);
  expect(Math.abs(line[0][0][0]-line[0].at(-1)[0])).toBeGreaterThan(0.049);
 });
 it('highlights a route only where it was valid',()=>{
  const trip={id:'t',routeSegments:[[A,B,null,C,D]],photos:[{id:'p',point:A}]};
  expect(highlightRoutes([trip],overviewPhotos([trip])).t).toEqual([[A,B],[C,D]]);
  const lonely={id:'u',routeSegments:[[A,null,D]],photos:[{id:'q',point:A}]};
  expect(highlightRoutes([lonely],overviewPhotos([lonely]))).toEqual({});
 });
});

describe('observed heatmap geometry, independent of density grid',()=>{
 const origin=[-34.56,150.86],cos=Math.cos(origin[0]*Math.PI/180);
 const at=(x,y)=>[origin[0]+y/111320,origin[1]+x/(111320*cos)];
 const xy=p=>[(p[1]-origin[1])*111320*cos,(p[0]-origin[0])*111320];
 it('never manufactures a staircase on a slanted straight road at any zoom band',()=>{
  const road=Array.from({length:501},(_,i)=>at(i*10,i*3));
  const density=routeDensity([journey('diagonal',road)]);
  for(const level of density.levels)for(const point of lines(level).flat()){
   const [x,y]=xy(point);expect(Math.abs(y-0.3*x)/Math.hypot(1,0.3)).toBeLessThan(0.01);
  }
  // The former drawing geometry visibly oscillates even with perfect input.
  const snapped=[...journeyEdges([road],25)].flatMap(edge=>edgePoints(edge,25));
  expect(Math.max(...snapped.map(p=>{const [x,y]=xy(p);return Math.abs(y-0.3*x)/Math.hypot(1,0.3);}))).toBeGreaterThan(5);
 });
 it('retains bends and genuine right-angle turns instead of connecting unrelated cells at junctions',()=>{
  const turn=[...Array.from({length:51},(_,i)=>at(i*10,0)),...Array.from({length:50},(_,i)=>at(500,(i+1)*10))];
  for(const level of routeDensity([journey('turn',turn)]).levels){
   for(const p of lines(level).flat()){const [x,y]=xy(p);expect(Math.min(Math.abs(y),Math.abs(x-500))).toBeLessThan(0.01);}
  }
  const a=[at(0,0),at(500,500)],b=[at(0,500),at(500,0)];
  for(const level of routeDensity([journey('first',a),journey('second',b)]).levels)for(const line of lines(level)){
   // Every line is a piece of one observed traversal, not a new turn at a grid junction.
   const deviations=line.map(p=>{const [x,y]=xy(p);return [Math.abs(y-x),Math.abs(y+x-500)];});
   expect(Math.min(Math.max(...deviations.map(d=>d[0])),Math.max(...deviations.map(d=>d[1])))).toBeLessThan(0.01);
  }
 });
 it('does not reconnect invalid samples that would have been skipped by the old stride',()=>{
  const route=Array.from({length:4000},(_,i)=>at(i*2,0));route[1999]=null;
  const j=journey('broken',route);
  for(const level of routeDensity([j]).levels)for(const line of lines(level)){
   const xs=line.map(p=>xy(p)[0]);expect(Math.min(...xs)<3997&&Math.max(...xs)>4000).toBe(false);
  }
 });
 it('chunks very long observed lines before the native polyline safety cap without losing the tail',()=>{
  const road=Array.from({length:1400},(_,i)=>at(i*60,i*3));
  const level=routeDensity([journey('long',road)],{cells:[25]}).levels[0];
  expect(lines(level).length).toBeGreaterThan(1);
  for(const line of lines(level))expect(line.length).toBeLessThanOrEqual(4900);
  expect(lines(level).flat().some(p=>Math.abs(xy(p)[0]-83940)<0.01)).toBe(true);
 });
});

it('keeps stationary drift and small lateral noise within their observed envelope, without grid amplification',()=>{
 const origin=[-34.56,150.86],cos=Math.cos(origin[0]*Math.PI/180);
 const at=(x,y)=>[origin[0]+y/111320,origin[1]+x/(111320*cos)];
 const road=Array.from({length:900},(_,i)=>at(i*4,(i%2?1:-1)*2));
 for(const level of routeDensity([journey('slight-noise',road)]).levels)for(const p of lines(level).flat())expect(Math.abs((p[0]-origin[0])*111320)).toBeLessThan(2.01);
 const stationary=Array.from({length:40},(_,i)=>at(Math.sin(i)*3,Math.cos(i)*3));
 const density=routeDensity([journey('stationary',stationary)]);
 for(const level of density.levels){expect(level.maxCount).toBe(1);for(const p of lines(level).flat()){
  const distance=Math.hypot((p[0]-origin[0])*111320,(p[1]-origin[1])*111320*cos);expect(distance).toBeLessThan(3.01);
 }}
});
