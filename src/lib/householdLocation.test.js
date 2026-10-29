import {describe,expect,it} from 'vitest';
import {atHome,formatAge,groupPeople,locationStatusText,memberLocationState,peoplePins,validPoint} from './householdLocation.js';
import {mapPayload} from './appleMaps.js';

const server='2026-11-04T08:00:00.000Z';
const ago=seconds=>new Date(Date.parse(server)-seconds*1000).toISOString();
const home={id:'home',kind:'home',latitude:-33.8700,longitude:151.2100,radius:100};
const anna={user_id:'anna',display_name:'Anna',sharing_enabled:true,latitude:-33.87005,longitude:151.21003,accuracy_m:12,location_at:ago(90),server_now:server};
const photo='data:image/jpeg;base64,/9j/AAAA';

describe('member location state',()=>{
 it('distinguishes off, waiting, live, stale and unavailable instead of one boolean',()=>{
  expect(memberLocationState({...anna,sharing_enabled:false}).state).toBe('off');
  expect(memberLocationState({...anna,latitude:null,longitude:null,location_at:null})).toMatchObject({state:'waiting',position:null});
  expect(memberLocationState(anna)).toMatchObject({state:'live',ageSeconds:90,position:{latitude:-33.87005,longitude:151.21003,accuracy:12}});
  expect(memberLocationState({...anna,location_at:ago(3600)})).toMatchObject({state:'stale',ageSeconds:3600});
  expect(memberLocationState({...anna,latitude:null,longitude:null,location_at:ago(90000)}).state).toBe('unavailable');
 });
 it('measures age on the server clock, so a wrong phone clock cannot make an old position live',()=>{
  expect(memberLocationState({...anna,location_at:ago(3600)},Date.parse(server)-3600*1000).state).toBe('stale');
 });
 it('never treats (0,0) or out-of-range coordinates as a position',()=>{
  expect(validPoint(0,0)).toBe(false);
  expect(validPoint(91,10)).toBe(false);
  expect(memberLocationState({...anna,latitude:0,longitude:0}).position).toBeNull();
 });
 it('explains each state in words',()=>{
  expect(locationStatusText({state:'live',ageSeconds:20})).toBe('Sharing location · updated just now');
  expect(locationStatusText({state:'live',ageSeconds:240})).toBe('Sharing location · updated 4 min ago');
  expect(locationStatusText({state:'stale',ageSeconds:720})).toBe('Last updated 12 min ago');
  expect(locationStatusText({state:'waiting'})).toBe('Waiting for location');
  expect(locationStatusText({state:'off'})).toBe('Location sharing off');
  expect(formatAge(7200)).toBe('2 h ago');
 });
});

describe('Home presence',()=>{
 it('uses the saved Home geofence with hysteresis so the tag does not flicker at the boundary',()=>{
  const inside={latitude:-33.8700,longitude:151.2109,accuracy:10}; // ~83 m
  const edge={latitude:-33.8700,longitude:151.21118,accuracy:10}; // ~109 m
  const away={latitude:-33.8700,longitude:151.2130,accuracy:10}; // ~277 m
  expect(atHome(false,inside,home)).toBe(true);
  expect(atHome(false,edge,home)).toBe(false);
  expect(atHome(true,edge,home)).toBe(true);
  expect(atHome(true,away,home)).toBe(false);
  expect(atHome(false,inside,null)).toBe(false);
 });
});

describe('map pins for people',()=>{
 const self={latitude:-33.87001,longitude:151.21001,accuracy:8,name:'Julius',home:true};
 it('shows both of us at Home as one marker with both identities, not one avatar hiding the other',()=>{
  const live={...anna,...memberLocationState(anna),home:true};
  const pins=peoplePins({self,members:[live],photos:{anna:photo},selfId:'julius',selfAvatar:photo});
  expect(pins).toHaveLength(1);
  expect(pins[0]).toMatchObject({kind:'people',home:true,title:'You & Anna',point:[-33.87001,151.21001],radius:8});
  expect(pins[0].members.map(m=>[m.name,m.self,m.state,m.home,Boolean(m.avatar)])).toEqual([['You',true,'live',true,true],['Anna',false,'live',true,true]]);
  expect(pins[0].subtitle).toContain('Home');
  expect(pins[0].subtitle).toContain('Anna: At Home · updated 2 min ago');
 });
 it("shows my wife's marker when she shares and I am viewing, even with no self position",()=>{
  const pins=peoplePins({members:[{...anna,...memberLocationState(anna)}],photos:{anna:photo}});
  expect(pins).toEqual([expect.objectContaining({kind:'people',title:'Anna',members:[expect.objectContaining({name:'Anna',state:'live',avatar:photo})]})]);
  expect(mapPayload([],null,null,[],pins).pins).toEqual([expect.objectContaining({kind:'people'})]);
 });
 it('groups three or more people at one place and keeps separate places separate',()=>{
  const people=[{latitude:-33.87,longitude:151.21},{latitude:-33.87001,longitude:151.21001},{latitude:-33.87002,longitude:151.21},{latitude:-33.88,longitude:151.21}];
  expect(groupPeople(people).map(g=>g.members.length)).toEqual([3,1]);
 });
 it('falls back to an initial when a member has no avatar',()=>{
  const [pin]=peoplePins({members:[{...anna,...memberLocationState(anna)}],photos:{}});
  expect(pin.members[0]).toMatchObject({avatar:null,initial:'A'});
 });
 it('labels a stale position with its age and never tags it Home',()=>{
  const stale={...anna,location_at:ago(5400)};
  const [pin]=peoplePins({members:[{...stale,...memberLocationState(stale),home:true}]});
  expect(pin.home).toBe(false);
  expect(pin.members[0]).toMatchObject({state:'stale',home:false});
  expect(pin.subtitle).toContain('Last updated 1 h 30 min ago');
 });
 it('omits members who do not share, are waiting, or have no current position',()=>{
  const rows=[{...anna,sharing_enabled:false},{...anna,user_id:'w',latitude:null,longitude:null,location_at:null},{...anna,user_id:'u',latitude:null,longitude:null,location_at:ago(90000)}];
  expect(peoplePins({members:rows.map(r=>({...r,...memberLocationState(r)}))})).toEqual([]);
 });
 it('never draws a placeholder initial: a member without a name gets a silhouette, not "F"',()=>{
  const nameless={...anna,display_name:''};
  const [pin]=peoplePins({members:[{...nameless,...memberLocationState(nameless)}],photos:{}});
  expect(pin.title).toBe('Household member');
  expect(pin.members[0]).toMatchObject({name:'Household member',initial:'',avatar:null});
  const [friend]=peoplePins({members:[{...nameless,source:'friend',...memberLocationState(nameless)}]});
  expect(friend.members[0]).toMatchObject({name:'Friend',initial:''});
 });
 it('uses each person\'s own photo by id and never someone else\'s',()=>{
  const other='data:image/jpeg;base64,/9j/BBBB';
  const [pin]=peoplePins({members:[{...anna,...memberLocationState(anna)}],photos:{stranger:other,ANNA:photo}});
  expect(pin.members[0].avatar).toBe(photo);
  const [unknown]=peoplePins({members:[{...anna,...memberLocationState(anna)}],photos:{stranger:other}});
  expect(unknown.members[0]).toMatchObject({avatar:null,initial:'A'});
 });
 it('picks up a changed profile photo on the next render',()=>{
  const member={...anna,...memberLocationState(anna)};
  const updated='data:image/jpeg;base64,/9j/CCCC';
  expect(peoplePins({members:[member],photos:{anna:photo}})[0].members[0].avatar).toBe(photo);
  expect(peoplePins({members:[member],photos:{anna:updated}})[0].members[0].avatar).toBe(updated);
 });
 it('shows my own photo on my bubble, from my preferences first',()=>{
  const mine='data:image/jpeg;base64,/9j/DDDD';
  const [pin]=peoplePins({self:{...self,home:false},photos:{julius:photo},selfId:'julius',selfAvatar:mine});
  expect(pin.members[0]).toMatchObject({self:true,avatar:mine,name:'You'});
 });
 it('displays my own marker from my position alone',()=>{
  expect(peoplePins({self:{...self,home:false}})).toEqual([expect.objectContaining({title:'You',home:false,members:[expect.objectContaining({self:true})]})]);
 });
});
