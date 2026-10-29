import {describe,expect,it} from 'vitest';
import {DENSITY_CELLS,densityBucket,densityKey,journeyEdges,routeDensity} from './routeDensity.js';
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
  const edges=[...journeyEdges([gap],25)];
  const rows=edges.flatMap(edge=>edge.split('|').map(cell=>Number(cell.split(':')[0])));
  // Both 110 m halves are drawn; nothing in the 37 km between them.
  const row=lat=>Math.floor(lat/(25/111320));
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.filter(r=>r<row(-33.87)&&r>row(-34.19))).toEqual([]);
  expect(rows).toContain(row(-34.2));
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
  expect(routes['trip-1']).toEqual([street()]);
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
