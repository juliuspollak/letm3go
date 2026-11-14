import {describe,expect,it} from 'vitest';
import {distanceAway,friendsStillLoading,homePeople} from './homePeople.js';

const here={latitude:-34.4,longitude:150.9};
const near={latitude:-34.4045,longitude:150.9};
const member=(user_id,state,extra={})=>({user_id,display_name:user_id,state,ageSeconds:30,position:near,...extra});

describe('people on Home',()=>{
 it('shows household members, not only friends who share',()=>{
  const people=homePeople({household:[member('Kim','live')],selfID:'me',selfPosition:here});
  expect(people).toHaveLength(1);
  expect(people[0].name).toBe('Kim');
 });
 it('lists someone in both once, and never you',()=>{
  const people=homePeople({household:[member('me','live'),member('Kim','live')],friends:[member('Kim','stale')],selfID:'me'});
  expect(people.map(person=>person.name)).toEqual(['Kim']);
 });
 it('says a household member was last verified at home with the real age, never that they are home now',()=>{
  const homePlace={latitude:near.latitude,longitude:near.longitude,radius:100};
  const [kim]=homePeople({household:[member('Kim','stale',{ageSeconds:1500,source:'household',position:{...near,accuracy:10}})],selfID:'me',selfPosition:here,homePlace});
  expect(kim.status).toEqual({text:'Last verified at home · 25 min ago',tone:'stale'});
  const [away]=homePeople({household:[member('Kim','stale',{ageSeconds:1500,source:'household',position:here})],selfID:'me',selfPosition:near,homePlace});
  expect(away.status.text).toMatch(/^Last seen 25 min ago · /);
  const [friend]=homePeople({friends:[member('Lee','stale',{ageSeconds:1500,source:'friend',position:near})],selfID:'me',homePlace});
  expect(friend.status.text).toBe('Last seen 25 min ago');
 });
 it('gives a home status its own marker',()=>{
  expect(homePeople({household:[member('Kim','live')],selfID:'me',homeFlags:{Kim:true}})[0].status).toEqual({text:'At home',tone:'home'});
 });
 it('adds a straight-line distance when both positions are known',()=>{
  expect(homePeople({household:[member('Kim','live')],selfID:'me',selfPosition:here})[0].status.text).toContain('500 m away');
  expect(homePeople({household:[member('Kim','live')],selfID:'me'})[0].status.text).not.toContain('away');
 });
 it('gives no distance for someone not sharing',()=>{
  expect(homePeople({household:[member('Kim','off',{position:null})],selfID:'me',selfPosition:here})[0].status).toEqual({text:'Not sharing',tone:'off'});
 });
 it('puts people with a current position first',()=>{
  const people=homePeople({household:[member('Ann','off'),member('Zed','live'),member('Bo','stale')],selfID:'me'});
  expect(people.map(person=>person.name)).toEqual(['Zed','Bo','Ann']);
 });
 it('follows the distance unit',()=>{
  expect(distanceAway(here,{latitude:-34.5,longitude:150.9},'km')).toBe('11 km away');
  expect(distanceAway(here,{latitude:-34.5,longitude:150.9},'mi')).toBe('6.9 mi away');
  expect(distanceAway(here,null)).toBeNull();
 });
 it('words a compact tile line, with the age and a distance only where they are true', ()=>{
  const short=(extra,opts={})=>homePeople({household:[member('Kim','live',extra)],selfID:'me',selfPosition:here,...opts})[0].short;
  expect(short({ageSeconds:480})).toBe('500 m · 8m ago');
  expect(short({ageSeconds:20})).toBe('500 m · just now');
  expect(short({ageSeconds:480,position:{latitude:-34.4234,longitude:150.9}})).toBe('2.6 km · 8m ago');
  expect(short({ageSeconds:30},{activities:{Kim:'Driving'}})).toBe('Driving · 500 m');
  expect(short({ageSeconds:30},{homeFlags:{Kim:true}})).toBe('At home');
  expect(short({position:null,ageSeconds:30,state:'off'})).toBe('Not sharing');
 });
 it('never words an old or missing position as current', ()=>{
  const one=(state,extra={},opts={})=>homePeople({household:[member('Kim',state,{source:'household',...extra})],selfID:'me',selfPosition:here,...opts})[0];
  expect(one('stale',{ageSeconds:1500}).short).toBe('500 m · 25m ago');
  expect(one('stale',{ageSeconds:1500,position:{...near,accuracy:10}},{homePlace:{latitude:near.latitude,longitude:near.longitude,radius:100}}).short).toBe('Last at home · 25m ago');
  expect(one('off',{position:null}).short).toBe('Not sharing');
  expect(one('none',{position:null}).short).toBe('No recent location');
  expect(one('waiting',{position:null}).short).toBe('Waiting');
  expect(one('stale',{ageSeconds:1500,position:null}).short).toBe('25m ago');
  // The full status the screen reader reads is unchanged.
  expect(one('stale',{ageSeconds:1500}).status.text).toMatch(/^Last seen 25 min ago/);
 });
 it('says which group a person belongs to', ()=>{
  const people=homePeople({household:[member('Kim','live',{source:'household'})],friends:[member('Lee','live',{source:'friend'})],selfID:'me'});
  expect(people.find(p=>p.name==='Kim').group).toBe('household');
  expect(people.find(p=>p.name==='Lee').group).toBe('friend');
 });
 it('never leaves a dangling separator when the age is unknown', ()=>{
  const homePlace={latitude:near.latitude,longitude:near.longitude,radius:100};
  const [kim]=homePeople({household:[member('Kim','stale',{ageSeconds:null,source:'household',position:{...near,accuracy:10}})],selfID:'me',homePlace});
  expect(kim.short).toBe('Last at home');
  expect(kim.short).not.toMatch(/·\s*$/);
 });
});

describe('friendsStillLoading',()=>{
 const base={configured:true,householdReady:false,friendsReady:false};
 it('is loading until both lists have answered',()=>{
  expect(friendsStillLoading(base)).toBe(true);
  expect(friendsStillLoading({...base,householdReady:true})).toBe(true);
  expect(friendsStillLoading({...base,friendsReady:true})).toBe(true);
  expect(friendsStillLoading({...base,householdReady:true,friendsReady:true})).toBe(false);
 });
 it('stops loading on a failure, a long wait, being offline, or with no account service',()=>{
  expect(friendsStillLoading({...base,householdError:'x'})).toBe(false);
  expect(friendsStillLoading({...base,friendsError:'x'})).toBe(false);
  expect(friendsStillLoading({...base,waitOver:true})).toBe(false);
  expect(friendsStillLoading({...base,online:false})).toBe(false);
  expect(friendsStillLoading({...base,configured:false})).toBe(false);
 });
});
