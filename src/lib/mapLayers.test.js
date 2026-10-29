import {afterEach,describe,expect,it} from 'vitest';
import {DEFAULT_MAP_VIEW,activeLayerCount,activityChoices,chooseRouteLayer,clearMapFilters,loadMapView,mapViewJourneys,normaliseMapView,saveMapView,supportsActivity,supportsRange} from './mapLayers.js';

const view=(changes={})=>({...DEFAULT_MAP_VIEW,...changes});
const DAY=86400;
const now=Date.parse('2026-10-27T12:00:00Z');
const at=days=>now/1000-days*DAY;
const journeys=[
 {id:'group',date:'2026-10-26',segments:[{date:'2026-10-27'}],segmentIDs:['recording'],activity:'Walking',startedAt:at(1)},
 {id:'older',date:'2026-10-25',activity:'Cycling',startedAt:at(2)},
 {id:'ancient',date:'2025-01-01',activity:'Cycling',startedAt:at(400)}
];
afterEach(()=>localStorage.clear());

describe('route layers',()=>{
 it('includes grouped journeys when a segment matches today or a saved activity',()=>{
  expect(mapViewJourneys(journeys,view({routes:'today'}),'2026-10-27',[],now)).toEqual([journeys[0]]);
  expect(mapViewJourneys(journeys,view({routes:'pinned'}),'2026-10-27',['recording'],now)).toEqual([journeys[0]]);
  expect(mapViewJourneys(journeys,view({routes:'all'}),'2026-10-27',[],now)).toEqual(journeys);
  expect(mapViewJourneys(journeys,view(),'2026-10-27',[],now)).toEqual([]);
 });
 it('keeps one route layer at a time, and choosing it again turns routes off without touching people',()=>{
  const all=chooseRouteLayer(view(),'all');
  expect(all).toMatchObject({routes:'all',people:true});
  expect(chooseRouteLayer(all,'today')).toMatchObject({routes:'today',people:true});
  expect(chooseRouteLayer(all,'all')).toMatchObject({routes:null,people:true});
  expect(chooseRouteLayer(all,'nonsense').routes).toBe('all');
 });
 it('lets people be shown or hidden independently of routes',()=>{
  expect(mapViewJourneys(journeys,view({routes:'all',people:false}),'2026-10-27',[],now)).toHaveLength(3);
  expect(activeLayerCount(view({people:false}))).toBe(1);
 });
 it('shows no routes on Community trails',()=>{
  expect(mapViewJourneys(journeys,view({content:'trails',routes:'all'}),'2026-10-27',[],now)).toEqual([]);
 });
});

describe('advanced filters',()=>{
 it('filters by activity type and date range where supported',()=>{
  expect(mapViewJourneys(journeys,view({routes:'all',activity:'Cycling'}),'2026-10-27',[],now).map(j=>j.id)).toEqual(['older','ancient']);
  expect(mapViewJourneys(journeys,view({routes:'all',range:'30d'}),'2026-10-27',[],now).map(j=>j.id)).toEqual(['group','older']);
  expect(mapViewJourneys(journeys,view({routes:'all',activity:'Cycling',range:'7d'}),'2026-10-27',[],now).map(j=>j.id)).toEqual(['older']);
 });
 it('only offers filters that do something, and only activity types that exist',()=>{
  expect(supportsActivity(view())).toBe(false);
  expect(supportsRange(view({routes:'today'}))).toBe(false);
  expect(supportsRange(view({routes:'all'}))).toBe(true);
  // Today has its own range: a stale date filter never hides today's routes.
  expect(mapViewJourneys(journeys,view({routes:'today',range:'7d'}),'2026-10-27',[],now)).toEqual([journeys[0]]);
  expect(activityChoices([...journeys,{activity:''},{activity:null}])).toEqual(['Cycling','Walking']);
 });
 it('clears only the filters and counts what is active for the indicator',()=>{
  const busy=view({routes:'all',activity:'Cycling',range:'7d'});
  expect(activeLayerCount(view())).toBe(0);
  expect(activeLayerCount(busy)).toBe(3);
  expect(clearMapFilters(busy)).toEqual(view({routes:'all'}));
  // A filter that does not apply is not counted.
  expect(activeLayerCount(view({activity:'Cycling'}))).toBe(0);
 });
});

describe('persistence',()=>{
 it('keeps the map view per account and ignores invalid stored values',()=>{
  saveMapView('anna',view({routes:'all',people:false}));
  expect(loadMapView('anna')).toEqual(view({routes:'all',people:false}));
  expect(loadMapView('kim')).toEqual(DEFAULT_MAP_VIEW);
  localStorage.setItem('letm3go:map-view:kim','{"content":"elsewhere","routes":"everything","range":"forever","people":"no"}');
  expect(loadMapView('kim')).toEqual(DEFAULT_MAP_VIEW);
  localStorage.setItem('letm3go:map-view:kim','not json');
  expect(loadMapView('kim')).toEqual(DEFAULT_MAP_VIEW);
  expect(normaliseMapView(null)).toEqual(DEFAULT_MAP_VIEW);
 });
});
