import {describe,expect,it} from 'vitest';
import {distanceAway,homePeople} from './homePeople.js';

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
});
