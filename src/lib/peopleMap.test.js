import {describe,expect,it} from 'vitest';
import {ACTIVITIES,STALE_FIT_METRES,cameraFit,formatDuration,personActivity,personLabel,savedPlaceName,secondsAtPlace} from './peopleMap.js';
import {memberLocationState,peoplePins} from './householdLocation.js';
import {cameraIntent,cameraReducer,initialCamera} from './mapCamera.js';

const server='2026-11-04T08:00:00.000Z';
const ago=seconds=>new Date(Date.parse(server)-seconds*1000).toISOString();
const row=(id,name,latitude,longitude,{at=60,arrived=null,accuracy=10}={})=>{
 const r={user_id:id,display_name:name,sharing_enabled:true,latitude,longitude,accuracy_m:accuracy,location_at:ago(at),server_now:server,arrived_at:arrived==null?null:ago(arrived)};
 return {...r,...memberLocationState(r,Date.parse(server))};
};
const HOME=[-33.8700,151.2100];
const gym={id:'gym',kind:'other',name:'Gym',latitude:-33.8500,longitude:151.1900,radius:120};
const homePlace={id:'home',kind:'home',name:'Home',latitude:HOME[0],longitude:HOME[1],radius:100};

describe('time at a place',()=>{
 it('formats durations compactly',()=>{
  expect(formatDuration(8100)).toBe('2h 15m');
  expect(formatDuration(42*60)).toBe('42m');
  expect(formatDuration(3600)).toBe('1h');
  expect(formatDuration(20)).toBe('1m');
  expect(formatDuration(27*3600)).toBe('1d 3h');
  expect(formatDuration(null)).toBe('');
 });
 it('uses only a confirmed arrival, on the server clock, for a live position',()=>{
  expect(secondsAtPlace(row('a','Anna',...HOME,{arrived:8100}))).toBe(8100);
  expect(secondsAtPlace(row('a','Anna',...HOME))).toBeNull();
  // A stale position says when it was updated, never how long they have been there.
  expect(secondsAtPlace(row('a','Anna',...HOME,{at:3600,arrived:8100}))).toBeNull();
  expect(secondsAtPlace({state:'live',arrived_at:'nonsense',server_now:server})).toBeNull();
  expect(secondsAtPlace({state:'live',arrived_at:ago(-60),server_now:server})).toBeNull();
 });
 it('keeps the same arrival through repeated location updates',()=>{
  const labels=[60,30,5].map(at=>peoplePins({members:[{...row('anna','Anna',HOME[0]+at*1e-7,HOME[1],{at,arrived:8100}),home:true}]})[0].label);
  expect(new Set(labels)).toEqual(new Set(['Home · 2h 15m']));
 });
 it('resets after a confirmed departure: the next visit is labelled from its own arrival',()=>{
  const before=peoplePins({members:[{...row('anna','Anna',...HOME,{arrived:8100}),home:true}]})[0];
  const atGym=peoplePins({members:[row('anna','Anna',gym.latitude,gym.longitude,{arrived:42*60})],places:[gym]})[0];
  expect(before.label).toBe('Home · 2h 15m');
  expect(atGym).toMatchObject({label:'Gym · 42m',labelKind:'place'});
  expect(atGym.members[0].label).toBe('At Gym · 42m');
 });
 it('never invents a duration: an unknown arrival falls back to place or last update',()=>{
  expect(peoplePins({members:[{...row('anna','Anna',...HOME),home:true}]})[0]).toMatchObject({label:'Home',labelKind:'home'});
  const [pin]=peoplePins({members:[row('anna','Anna',-33.9,151.3,{at:240})]});
  expect(pin.label).toBeUndefined();
  expect(pin.members[0].label).toBe('Updated 4 min ago');
  expect(pin.members[0]).not.toHaveProperty('secondsAtPlace');
 });
 it('describes each case in words',()=>{
  expect(personLabel({state:'live',home:true,seconds:8100})).toEqual({text:'At Home · 2h 15m',short:'Home · 2h 15m',kind:'home'});
  expect(personLabel({state:'live',place:'Gym',seconds:2520}).text).toBe('At Gym · 42m');
  expect(personLabel({state:'live',seconds:1080}).text).toBe('At a place · 18m');
  expect(personLabel({state:'stale',ageSeconds:720,home:true,seconds:8100})).toEqual({text:'Last updated 12 min ago',short:'12 min ago',kind:'stale'});
  expect(personLabel({state:'live',ageSeconds:20}).text).toBe('Updated just now');
 });
});

describe('place names',()=>{
 it('names a place only from the viewer\'s own saved places, and never Home (that has its own hysteresis)',()=>{
  expect(savedPlaceName({latitude:gym.latitude,longitude:gym.longitude,accuracy:10},[gym,homePlace])).toBe('Gym');
  expect(savedPlaceName({latitude:HOME[0],longitude:HOME[1],accuracy:10},[gym,homePlace])).toBeNull();
  expect(savedPlaceName({latitude:-33.86,longitude:151.19,accuracy:10},[gym])).toBeNull();
  // An uncertain fix straddling the edge is not claimed to be inside.
  expect(savedPlaceName({latitude:gym.latitude+110/111195,longitude:gym.longitude,accuracy:60},[gym])).toBeNull();
  expect(savedPlaceName({latitude:gym.latitude,longitude:gym.longitude},[{...gym,name:'  '}])).toBeNull();
 });
});

describe('movement status for the person model',()=>{
 it('only reports what is known, otherwise unknown',()=>{
  expect(personActivity({state:'live',shared:'Driving'})).toBe('driving');
  expect(personActivity({state:'live',shared:'Cycling'})).toBe('cycling');
  expect(personActivity({state:'live',shared:'Walking'})).toBe('walking');
  expect(personActivity({state:'live',shared:'Running'})).toBe('running');
  expect(personActivity({state:'live',home:true})).toBe('home');
  expect(personActivity({state:'live',seconds:600})).toBe('stationary');
  expect(personActivity({state:'live'})).toBe('unknown');
  expect(personActivity({state:'stale',shared:'Driving'})).toBe('unknown');
  expect(personActivity({state:'live',shared:'On the move'})).toBe('unknown');
 });
 it('never infers driving from GPS speed',()=>{
  const fast={...row('anna','Anna',-33.9,151.3),speed_kmh:90};
  expect(peoplePins({members:[fast]})[0].members[0].activity).toBe('unknown');
  expect(peoplePins({members:[fast],activities:{anna:'Driving'}})[0].members[0].activity).toBe('driving');
  expect(ACTIVITIES).toEqual(['driving','walking','cycling','running','stationary','home','unknown']);
 });
});

describe('who the camera fits',()=>{
 const p=(id,state,latitude,longitude)=>({id,state,latitude,longitude});
 it('fits everyone live, and a stale position only near someone live',()=>{
  expect(cameraFit([p('self','live',...HOME),p('anna','live',-33.95,151.25),p('kim','stale',51.5,-0.12),p('sam','stale',-33.88,151.22)]))
   .toEqual({self:true,anna:true,kim:false,sam:true});
  expect(STALE_FIT_METRES).toBe(25000);
 });
 it('fits every last known position when nobody is live',()=>{
  expect(cameraFit([p('kim','stale',51.5,-0.12),p('sam','stale',-33.88,151.22)])).toEqual({kim:true,sam:true});
  expect(cameraFit([])).toEqual({});
 });
 it('marks pins so a stale far-away member is shown but not fitted',()=>{
  const pins=peoplePins({self:{latitude:HOME[0],longitude:HOME[1],accuracy:8},members:[row('kim','Kim',51.5,-0.12,{at:5000})]});
  expect(pins.map(pin=>[pin.id,pin.fit])).toEqual([['people:self',true],['people:kim',false]]);
 });
});

describe('stable people pins',()=>{
 it('keys a pin by the user ids there, not by names or coordinates',()=>{
  const first=peoplePins({members:[row('anna','Anna',-33.9,151.3)]})[0];
  const moved=peoplePins({members:[row('anna','Anna Pollak',-33.9001,151.3002)]})[0];
  expect(first.id).toBe('people:anna');
  expect(moved.id).toBe(first.id);
 });
 it('groups several members at Home into one pin with every person, labelled Home',()=>{
  const members=['anna','sam','lee'].map((id,i)=>({...row(id,id.toUpperCase(),HOME[0]+i*1e-5,HOME[1],{arrived:3600*(i+1)}),home:true}));
  const [pin]=peoplePins({self:{latitude:HOME[0],longitude:HOME[1],accuracy:8,home:true},members});
  expect(pin).toMatchObject({id:'people:anna,lee,sam,self',home:true,label:'Home',labelKind:'home',fit:true});
  expect(pin.members.map(m=>[m.id,m.label])).toEqual([['self','At Home'],['anna','At Home · 1h'],['sam','At Home · 2h'],['lee','At Home · 3h']]);
  expect(pin.subtitle).toContain('ANNA: At Home · 1h · updated 1 min ago');
 });
 it('drops a member as soon as their sharing is revoked',()=>{
  const sharing=row('anna','Anna',-33.9,151.3);
  expect(peoplePins({members:[sharing]})).toHaveLength(1);
  const revoked={...sharing,sharing_enabled:false,latitude:null,longitude:null};
  expect(peoplePins({members:[{...revoked,...memberLocationState(revoked)}]})).toEqual([]);
 });
});

describe('camera mode',()=>{
 it('opens showing everyone',()=>{
  expect(initialCamera).toMatchObject({mode:'all',personId:null});
  expect(cameraIntent(initialCamera,'owner')).toEqual({key:'people:owner',mode:'all',personId:null,command:initialCamera.command,includeRoutes:false});
 });
 it('focuses a selected member and returns to everyone with a new command each time',()=>{
  const focused=cameraReducer(initialCamera,{type:'focus',personId:'anna'});
  expect(focused).toEqual({mode:'person',personId:'anna',command:initialCamera.command+1});
  const all=cameraReducer(focused,{type:'showAll'});
  expect(all).toEqual({mode:'all',personId:null,command:initialCamera.command+2});
  expect(cameraReducer(all,{type:'focus',personId:null}).mode).toBe('all');
 });
 it('mirrors native changes for the current command only',()=>{
  const state=cameraReducer(initialCamera,{type:'showAll'});
  const free=cameraReducer(state,{type:'native',mode:'free',command:state.command});
  expect(free).toEqual({...state,mode:'free'});
  // The user tapped "Show on map" while a gesture report was in flight: the newer request wins.
  const focused=cameraReducer(free,{type:'focus',personId:'anna'});
  expect(cameraReducer(focused,{type:'native',mode:'free',command:free.command})).toBe(focused);
  expect(cameraReducer(free,{type:'native',mode:'person',personId:'sam',command:free.command})).toMatchObject({mode:'person',personId:'sam',command:free.command});
  expect(cameraReducer(free,{type:'native',mode:'person',command:free.command})).toBe(free);
  expect(cameraReducer(free,{type:'native',mode:'sideways',command:free.command})).toBe(free);
  expect(cameraReducer(free,{type:'native',mode:'free',command:free.command})).toBe(free);
 });
 it('keys the viewport by account, so another account never restores it',()=>{
  expect(cameraIntent(initialCamera,'a').key).not.toBe(cameraIntent(initialCamera,'b').key);
  expect(cameraIntent(initialCamera,'a',true).includeRoutes).toBe(true);
 });
});
