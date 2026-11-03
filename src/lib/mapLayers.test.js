import {afterEach,describe,expect,it} from 'vitest';
import {DEFAULT_MAP_VIEW,activeMapFilters,activityChoices,chooseRouteLayer,clearMapFilters,loadMapView,mapViewJourneys,normaliseMapView,saveMapView,supportsActivity,supportsRange} from './mapLayers.js';

const view=(changes={})=>({...DEFAULT_MAP_VIEW,routes:null,...changes});
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
  expect(mapViewJourneys(journeys,view({routes:'today'}),'2026-10-27',[],[],now)).toEqual([journeys[0]]);
  expect(mapViewJourneys(journeys,view({routes:'pinned'}),'2026-10-27',['recording'],[],now)).toEqual([journeys[0]]);
  expect(mapViewJourneys(journeys,view({routes:'all'}),'2026-10-27',[],[],now)).toEqual(journeys);
  expect(mapViewJourneys(journeys,view(),'2026-10-27',[],[],now)).toEqual([]);
 });
 it('keeps one route layer at a time, and choosing it again turns routes off without touching people',()=>{
  const all=chooseRouteLayer(view(),'all');
  expect(all).toMatchObject({routes:'all',people:true});
  expect(chooseRouteLayer(all,'today')).toMatchObject({routes:'today',people:true});
  expect(chooseRouteLayer(all,'all')).toMatchObject({routes:null,people:true});
  expect(chooseRouteLayer(all,'nonsense').routes).toBe('all');
 });
 it('lets people be shown or hidden independently of routes',()=>{
  expect(mapViewJourneys(journeys,view({routes:'all',people:false}),'2026-10-27',[],[],now)).toHaveLength(3);
  expect(activeMapFilters(view({people:false})).length).toBe(1);
 });
 it('hides archived journeys and grouped journeys only when asked, and loads older saved views',()=>{
  const trips=[{id:'a',date:'2026-10-27'},{id:'b',date:'2026-10-27'},{id:'group',date:'2026-10-27',segmentIDs:['c','d']}];
  expect(mapViewJourneys(trips,view({routes:'all'}),'2026-10-27',[],['a','c'],now)).toHaveLength(3);
  expect(mapViewJourneys(trips,view({routes:'all',archived:false}),'2026-10-27',[],['a','c'],now).map(t=>t.id)).toEqual(['b']);
  expect(normaliseMapView({routes:'all',people:false})).toMatchObject({routes:'all',people:false,style:'standard',archived:true});
  expect(normaliseMapView({style:'neon',archived:false})).toMatchObject({style:'standard',archived:false});
 });
 it('shows no routes on Community trails',()=>{
  expect(mapViewJourneys(journeys,view({content:'trails',routes:'all'}),'2026-10-27',[],[],now)).toEqual([]);
 });
});

describe('advanced filters',()=>{
 it('filters by activity type and date range where supported',()=>{
  expect(mapViewJourneys(journeys,view({routes:'all',activity:'Cycling'}),'2026-10-27',[],[],now).map(j=>j.id)).toEqual(['older','ancient']);
  expect(mapViewJourneys(journeys,view({routes:'all',range:'30d'}),'2026-10-27',[],[],now).map(j=>j.id)).toEqual(['group','older']);
  expect(mapViewJourneys(journeys,view({routes:'all',activity:'Cycling',range:'7d'}),'2026-10-27',[],[],now).map(j=>j.id)).toEqual(['older']);
 });
 it('only offers filters that do something, and only activity types that exist',()=>{
  expect(supportsActivity(view())).toBe(false);
  expect(supportsRange(view({routes:'today'}))).toBe(false);
  expect(supportsRange(view({routes:'all'}))).toBe(true);
  // Today has its own range: a stale date filter never hides today's routes.
  expect(mapViewJourneys(journeys,view({routes:'today',range:'7d'}),'2026-10-27',[],[],now)).toEqual([journeys[0]]);
  expect(activityChoices([...journeys,{activity:''},{activity:null}])).toEqual(['Cycling','Walking']);
 });
 it('clears only the filters and counts what is active for the indicator',()=>{
  const busy=view({routes:'all',activity:'Cycling',range:'7d'});
  expect(activeMapFilters(view()).length).toBe(0);
  expect(activeMapFilters(busy).length).toBe(3);
  expect(clearMapFilters(busy)).toEqual(view({routes:'all'}));
  // A filter that does not apply is not counted.
  expect(activeMapFilters(view({activity:'Cycling'})).length).toBe(0);
 });
});

describe('persistence',()=>{
 it('keeps the map view per account and ignores invalid stored values',()=>{
  saveMapView('anna',view({people:false,style:'satellite',archived:false}));
  expect(loadMapView('anna')).toEqual(view({routes:'today',people:false,style:'satellite',archived:false}));
  expect(loadMapView('kim')).toEqual(DEFAULT_MAP_VIEW);
  localStorage.setItem('letm3go:map-view:kim','{"content":"elsewhere","routes":"everything","range":"forever","people":"no"}');
  expect(loadMapView('kim')).toEqual(DEFAULT_MAP_VIEW);
  localStorage.setItem('letm3go:map-view:kim','not json');
  expect(loadMapView('kim')).toEqual(DEFAULT_MAP_VIEW);
  expect(normaliseMapView(null)).toEqual(DEFAULT_MAP_VIEW);
 });
 it('always opens the routes on Today, whatever filter was left',()=>{
  saveMapView('anna',view({routes:'all',range:'7d',day:'2026-10-28',activity:'Walking',style:'satellite'}));
  expect(loadMapView('anna')).toEqual(view({routes:'today',style:'satellite'}));
  saveMapView('anna',view({routes:null}));
  expect(loadMapView('anna').routes).toBe('today');
 });
});

describe('selected calendar day',()=>{
 it('loads old rolling preferences unchanged and validates new dates per account',()=>{
  localStorage.setItem('letm3go:map-view:old',JSON.stringify({routes:'pinned',range:'30d',activity:'Walking'}));
  expect(normaliseMapView({routes:'pinned',range:'30d',activity:'Walking'})).toEqual(view({routes:'pinned',range:'30d',activity:'Walking'}));
  saveMapView('new',view({routes:'all',day:'2026-10-26',range:'7d'}));
  expect(normaliseMapView(view({routes:'all',day:'2026-10-26',range:'7d'}))).toEqual(view({routes:'all',day:'2026-10-26',range:'7d'}));
  expect(loadMapView('old').day).toBeNull();
  expect(normaliseMapView({day:'2026-02-30'}).day).toBeNull();
 });
 it('matches midnight crossings but not unobserved days between segments',()=>{
  const seconds=text=>new Date(text).getTime()/1000;
  const crossing={id:'night',startedAt:seconds('2026-10-25T23:30:00'),endedAt:seconds('2026-10-26T00:30:00')};
  const grouped={id:'group',segments:[{date:'2026-10-24'},{date:'2026-10-27'}]};
  const ending={id:'boundary',startedAt:seconds('2026-10-25T23:00:00'),endedAt:seconds('2026-10-26T00:00:00')};
  expect(mapViewJourneys([crossing,grouped,ending],view({routes:'all',day:'2026-10-26',range:'7d'}),'2026-10-30',[],[],now)).toEqual([crossing]);
  expect(mapViewJourneys([crossing],view({routes:'all',day:'2026-10-25'}),'2026-10-30')).toEqual([crossing]);
 });
});

describe('the default map view',()=>{
 it('opens on today\'s routes',()=>expect(normaliseMapView(null).routes).toBe('today'));
 it('moves an old saved default to Today once',()=>expect(normaliseMapView({routes:null,style:'satellite'})).toMatchObject({routes:'today',style:'satellite'}));
 it('keeps a real choice made before the change',()=>expect(normaliseMapView({routes:'all'}).routes).toBe('all'));
 it('keeps routes off once the person turns them off',()=>{
  const off=chooseRouteLayer(normaliseMapView(null),'today');
  expect(off.routes).toBeNull();
  expect(normaliseMapView(JSON.parse(JSON.stringify(off))).routes).toBeNull();
 });
});
