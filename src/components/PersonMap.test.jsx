import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({empty:false,payloads:[],onStep:null,day:null,dayArgs:[],rpc:vi.fn(),mounts:0}));
vi.mock('./AppleMap.jsx',async()=>{
 const {useEffect}=await import('react');
 function MockMap({payload,onStep,day}){mock.payloads.push(payload);mock.onStep=onStep;mock.day=day;useEffect(()=>{mock.mounts++;},[]);return <div data-testid="map"/>;}
 return {default:MockMap};
});
vi.mock('../lib/supabase.js',()=>({supabase:{rpc:mock.rpc}}));
vi.mock('../lib/usePersonDay.js',async()=>{
 const {composeDay}=await import('../lib/personDay.js');
 const {dayWindow}=await import('../lib/dayWindow.js');
 return {usePersonDay:args=>{
  mock.dayArgs.push(args);
  const w=dayWindow(args.date,args.timeZone);
  const row=(id,t,title)=>({activity_id:id,title,activity:'Driving',started_at:new Date((w.start+t)*1000).toISOString(),ended_at:new Date((w.start+t+600)*1000).toISOString(),roads:{},
   points:[{latitude:-34.5,longitude:150.9,segment:0,t:w.start+t},{latitude:-34.6,longitude:150.9,segment:0,t:w.start+t+30},{latitude:-34.7,longitude:150.95,segment:1,t:w.start+t+600}]});
  const day=mock.empty?composeDay({date:args.date,timeZone:args.timeZone,now:Date.now()/1000,rows:[],live:null}):composeDay({date:args.date,timeZone:args.timeZone,now:Date.now()/1000,rows:[row('a',1000,'Home to work'),row('b',5000,'Work to shops')],
   live:{points:[[-34.8,151,w.start+8000,0],[-34.81,151,w.start+8060,0]],roads:{}}});
  return {day,loading:false,error:''};
 }};
});
import PersonMap from './PersonMap.jsx';
import AppleMap from './AppleMap.jsx';
import {dayKeyOf,addDays} from '../lib/dayWindow.js';

const Z='Australia/Sydney';
const selectedPin={id:'people:her',kind:'people',point:[-34.9,151.1],title:'Julia',label:'Driving · 90 km/h',labelKind:'live',members:[{id:'her',name:'Julia',initial:'J',avatar:'data:image/png;base64,a',state:'live',activity:'driving'}]};
const person={userId:'her',name:'Julia',position:{latitude:-34.9,longitude:151.1},state:'live',status:{text:'Sharing location · updated just now',tone:'live'}};
// The Map tab's one map, drawn by whoever renders PersonMap (JourneyMap in the app).
const renderMap=day=><AppleMap payload={day?.payload??{all:true}} onStep={day?.onStep} day={day}/>;
const setup=(over={})=>{
 const onOpenShared=vi.fn();
 const selected=over.person===undefined?person:over.person;
 const personPin=over.personPin!==undefined?over.personPin:selected?.userId==='her'&&selected.position&&['live','stale'].includes(selected.state)?(selected.state==='stale'?{...selectedPin,label:'Last seen 25 min ago',labelKind:'stale',members:[{...selectedPin.members[0],state:'stale',activity:null}]}:selectedPin):null;
 const view=render(<PersonMap person={person} personPin={personPin} viewer="me" timeZone={Z} renderMap={renderMap} onOpenShared={onOpenShared} {...over}/>);
 return {onOpenShared,view};
};
const last=()=>mock.payloads.at(-1);
const control=id=>act(()=>mock.day.onControl(id));
const locate=async()=>{await act(async()=>{await mock.day.onLocate();});};
afterEach(cleanup);
beforeEach(()=>{mock.empty=false;mock.mounts=0;mock.payloads.length=0;mock.dayArgs.length=0;mock.day=null;mock.rpc.mockReset();});

describe('person map',()=>{
 it('shows visible saved routes and compact numbered flags, plus the latest location and live trail',()=>{
  setup();
  const pins=last().pins;
  expect(pins.filter(p=>p.kind==='step').map(p=>[p.label,p.activityID,p.point])).toEqual([['1','a',[-34.5,150.9]],['2','b',[-34.5,150.9]]]);
  expect(last().styled.map(r=>r.activityID)).toEqual(['a','b']);
  expect(last().styled.every(r=>r.width===3.75)).toBe(true);
  expect(pins.find(p=>p.kind==='people')).toEqual(selectedPin);
  expect(pins.some(p=>p.kind==='friend-live')).toBe(false);
  expect(last().live.length).toBe(2);
  expect(mock.day.date.label).toBe('Today');
 });
 it('shows the same single-person avatar and speed marker as All people, not an initial-only friend marker',()=>{
  setup();
  const marker=last().pins.find(pin=>pin.kind==='people');
  expect(marker).toBe(selectedPin);
  expect(marker.members[0].avatar).toContain('data:image/png');
  expect(marker.label).toBe('Driving · 90 km/h');
  expect(last().pins.some(pin=>pin.kind==='friend-live')).toBe(false);
 });
 it('never shows another member or a shared-place group on a selected person map',()=>{
  setup({personPin:{...selectedPin,members:[...selectedPin.members,{id:'other',name:'Other'}]}});
  expect(last().pins.some(pin=>pin.kind==='people')).toBe(false);
 });
 it('hands the map a stable identity and a fit key per day, so day changes update in place',()=>{
  setup();
  const today=dayKeyOf(Date.now()/1000,Z);
  expect(last().fitKey).toBe('her|'+today);
  control('pday:prev');
  expect(last().fitKey).toBe('her|'+addDays(today,-1));
 });
 it('draws its own chrome nowhere: no header, day row, legend text or poke inside the map area',()=>{
  setup();
  expect(screen.queryByLabelText('Previous day')).toBeNull();
  expect(screen.queryByText(/Solid lines/)).toBeNull();
  expect(screen.queryByText(/Poke/)).toBeNull();
 });
 it('opens the shared-activity detail of the right person and activity from a marker, leaving the map in place',()=>{
  const {onOpenShared}=setup();
  act(()=>mock.onStep('b'));
  fireEvent.click(screen.getByRole('button',{name:'Open activity'}));
  expect(onOpenShared).toHaveBeenCalledWith('b',{userId:'her',name:'Julia'});
  expect(screen.getByTestId('map')).toBeTruthy();
 });
 it('still shows the person\'s activities when they are not sharing a live position, and invents no location', ()=>{
  setup({person:{...person,position:null,state:'off',status:{text:'Not sharing live location',tone:'stale'}}});
  expect(mock.dayArgs.at(-1).enabled).toBe(true);
  expect(last().styled.map(r=>r.activityID)).toEqual(['a','b']);
  expect(last().pins.some(p=>p.kind==='people')).toBe(false);
 });
 it('shows the same single map for All people, without day loading or a date bar',()=>{
  setup({person:null});
  expect(last()).toEqual({all:true});
  expect(mock.day).toBeNull();
  expect(mock.dayArgs.at(-1).enabled).toBe(false);
 });
 it('switches person and goes back to All people on the one mounted map', ()=>{
  const {view}=setup({person:null});
  const props={viewer:'me',timeZone:Z,renderMap};
  view.rerender(<PersonMap person={person} {...props}/>);
  expect(last().fitKey).toMatch(/^her\|/);
  view.rerender(<PersonMap person={{...person,userId:'him',name:'Sam'}} {...props}/>);
  expect(last().fitKey).toMatch(/^him\|/);
  expect(mock.dayArgs.at(-1).owner).toBe('him');
  view.rerender(<PersonMap person={null} {...props}/>);
  expect(last()).toEqual({all:true});
  expect(mock.mounts).toBe(1); // the map was updated in place, never re-created
 });
 it('starts a newly selected person at Today', ()=>{
  const {view}=setup();
  control('pday:prev');
  view.rerender(<PersonMap person={{...person,userId:'him',name:'Sam'}} viewer="me" timeZone={Z} renderMap={renderMap}/>);
  expect(mock.dayArgs.at(-1).date).toBe(dayKeyOf(Date.now()/1000,Z));
 });
 it('moves between days with the map\'s date bar, and cannot go past today',()=>{
  setup();
  const today=dayKeyOf(Date.now()/1000,Z);
  expect(mock.day.date.next.disabled).toBe(true);expect(mock.day.date.today).toBeNull();
  control('pday:prev');
  expect(mock.dayArgs.at(-1).date).toBe(addDays(today,-1));
  expect(mock.day.date.label).toBe('Yesterday');expect(mock.day.date.today).toMatchObject({id:'pday:today'});
  // The latest-location pin and live trail belong to today only.
  expect(last().pins.some(p=>p.kind==='people')).toBe(false);expect(last().live).toEqual([]);
  control('pday:next');
  expect(mock.dayArgs.at(-1).date).toBe(today);
  control('pday:prev');control('pday:prev');control('pday:today');
  expect(mock.dayArgs.at(-1).date).toBe(today);
 });
 it('scrubs entirely in memory: a playback marker, no network, and the line stops at that time',()=>{
  setup();
  const slider=screen.getByLabelText('Time of day');
  const before=last().routes.length;
  fireEvent.change(slider,{target:{value:String(Number(slider.min)+1)}});
  const marker=last().pins.find(p=>p.kind==='playback');
  expect(marker).toBeTruthy();expect(marker.title).toMatch(/Recorded at/);
  expect(last().pins.some(p=>p.kind==='people')).toBe(true); // the live marker stays distinct
  expect(last().live).toEqual([]);expect(last().estimated).toEqual([]);
  expect(last().routes.length).toBeLessThanOrEqual(before);
  expect(mock.rpc).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Now'));
  expect(last().pins.some(p=>p.kind==='playback')).toBe(false);
 });
 it('keeps the camera where it is while scrubbing: the fit key never changes', ()=>{
  setup();
  const key=last().fitKey;
  const slider=screen.getByLabelText('Time of day');
  fireEvent.change(slider,{target:{value:String(Number(slider.min)+5)}});
  fireEvent.change(slider,{target:{value:String(Number(slider.min)+500)}});
  expect(last().fitKey).toBe(key);expect(last().focus).toBeUndefined();
 });
 it('says so, instead of inventing a point, when the slider is inside a GPS gap',()=>{
  setup();
  const slider=screen.getByLabelText('Time of day');
  fireEvent.change(slider,{target:{value:String(Number(slider.min)+450)}});
  expect(last().pins.find(p=>p.kind==='playback').title).toMatch(/No GPS signal/);
  expect(screen.getByText(/No GPS signal/)).toBeTruthy();
  expect(last().pins.find(p=>p.kind==='playback').title).not.toMatch(/ago earlier|just now earlier/);
 });
 it('left open on Today past midnight, moves on to the new day; a day the person picked stays put',()=>{
  vi.useFakeTimers();
  try{
   vi.setSystemTime(new Date('2026-11-10T12:59:30Z')); // 23:59:30 in Sydney
   setup();
   expect(mock.dayArgs.at(-1).date).toBe('2026-11-10');
   act(()=>{vi.advanceTimersByTime(61000);});
   expect(mock.dayArgs.at(-1).date).toBe('2026-11-11');
   expect(mock.day.date.label).toBe('Today');
   expect(last().pins.some(p=>p.kind==='people')).toBe(true);
   control('pday:prev');
   expect(mock.dayArgs.at(-1).date).toBe('2026-11-10');
   act(()=>{vi.advanceTimersByTime(24*3600*1000);});
   expect(mock.dayArgs.at(-1).date).toBe('2026-11-10');   // picked day does not move
  }finally{vi.useRealTimers();}
 });
 it('keeps estimated roads within what the native map draws',()=>{
  setup();
  expect(last().estimated.every(line=>line.length<=2000)).toBe(true);
 });
 it('gives the phone\'s own activities to my map only, never to someone else\'s',()=>{
  const local=[{id:'x'}];
  render(<PersonMap person={{...person,userId:'me'}} viewer="me" timeZone={Z} localTrips={local} deletedIDs={['d']} renderMap={renderMap}/>);
  expect(mock.dayArgs.at(-1).localTrips).toBe(local);expect(mock.dayArgs.at(-1).deletedIDs).toEqual(['d']);
  cleanup();
  setup({localTrips:local});
  expect(mock.dayArgs.at(-1).localTrips).toBeNull();
 });
 it('on my own map, an activity that is not on this phone says so instead of opening a shared copy that does not exist',()=>{
  render(<PersonMap person={{...person,userId:'me'}} viewer="me" timeZone={Z} onOpenOwn={()=>false} renderMap={renderMap}/>);
  act(()=>mock.onStep('b'));
  fireEvent.click(screen.getByRole('button',{name:'Open activity'}));
  expect(screen.getByText(/not on this phone/)).toBeTruthy();
 });
 it('on my own map, an activity on this phone opens locally',()=>{
  const open=vi.fn(()=>true);
  render(<PersonMap person={{...person,userId:'me'}} viewer="me" timeZone={Z} onOpenOwn={open} renderMap={renderMap}/>);
  act(()=>mock.onStep('a'));
  fireEvent.click(screen.getByRole('button',{name:'Open activity'}));
  expect(open).toHaveBeenCalledWith('a');
 });
 it('on my own map an empty day just says nothing is recorded',()=>{
  mock.empty=true;
  setup({person:{...person,userId:'me',name:'Me'}});
  expect(document.querySelector('.person-map-note').textContent).toBe('No movement recorded yet today.');
  control('pday:prev');
  expect(document.querySelector('.person-map-note').textContent).toBe('Nothing recorded for this day.');
 });
 it('explains an empty day for someone else: their drives appear once their phone has backed them up',()=>{
  mock.empty=true;
  setup();
  expect(document.querySelector('.person-map-note').textContent).toBe("No recorded drives from Julia yet today. Drives appear here once Julia's phone has backed them up.");
  control('pday:prev');
  expect(document.querySelector('.person-map-note').textContent).toBe('Nothing shared by Julia for this day.');
 });
 it('says something only when it has something to say, in one line below the map',()=>{
  setup();
  expect(document.querySelector('.person-map-note')).toBeNull();
 });
});

describe('the Locate button', ()=>{
 const here={latitude:-33.8,longitude:151.2};
 const today=()=>dayKeyOf(Date.now()/1000,Z);
 it('All people: not this component\'s concern - it hands the map no locate handler', ()=>{
  setup({person:null});
  expect(mock.day).toBeNull();
 });
 it('Me: centres on my current location', async()=>{
  const locateSelf=vi.fn(async()=>here);
  setup({person:{...person,userId:'me',self:true,position:null},viewer:'me',locateSelf});
  await locate();
  expect(locateSelf).toHaveBeenCalledTimes(1);
  expect(last().focus).toEqual([-33.8,151.2]);
  expect(last().fitKey).toBe('me|'+today()+'|locate1');
 });
 it('Me: says my location is unavailable, and does not move the camera or invent a point', async()=>{
  const key='me|'+today();
  setup({person:{...person,userId:'me',self:true,position:null},viewer:'me',locateSelf:vi.fn(async()=>null)});
  await locate();
  expect(screen.getByText(/location is not available/i)).toBeTruthy();
  expect(last().focus).toBeUndefined();expect(last().fitKey).toBe(key);
 });
 it('Someone else, today: centres on my own fresh location, never theirs', async()=>{
  const locateSelf=vi.fn(async()=>here);
  setup({locateSelf});await locate();
  expect(locateSelf).toHaveBeenCalledTimes(1);
  expect(last().focus).toEqual([-33.8,151.2]);
 });
 it('uses my own location on a historical day too, preserving that day', async()=>{
  setup({locateSelf:async()=>here});control('pday:prev');
  const dayKey=last().fitKey;await locate();
  expect(last().focus).toEqual([-33.8,151.2]);expect(last().fitKey).toBe(dayKey+'|locate1');
  expect(last().pins.some(p=>p.kind==='people')).toBe(false);
 });
 it('never substitutes a selected person or a recorded route when my location is unavailable',async()=>{
  setup({locateSelf:async()=>null});const key=last().fitKey;await locate();
  expect(screen.getByText(/Your location is not available/)).toBeTruthy();
  expect(last().focus).toBeUndefined();expect(last().fitKey).toBe(key);
 });
 it('rejects invalid coordinates even if a location provider returns them',async()=>{
  setup({locateSelf:async()=>({latitude:99,longitude:151})});await locate();
  expect(last().focus).toBeUndefined();
 });
 it('asks again each time, and a new day or person forgets the request', async()=>{
  setup({locateSelf:async()=>here});
  await locate();await locate();
  expect(last().fitKey).toMatch(/locate2$/);
  control('pday:prev');
  expect(last().fitKey).not.toMatch(/locate/);expect(last().focus).toBeUndefined();
 });
 it('does not re-centre by itself: live points and the clock leave the fit key alone', async()=>{
  setup();
  await locate();
  const key=last().fitKey;
  await act(async()=>{await Promise.resolve();});
  expect(last().fitKey).toBe(key);
 });
 it('ignores a slow answer for someone I have since switched away from', async()=>{
  let resolve;const locateSelf=vi.fn(()=>new Promise(r=>{resolve=r;}));
  const {view}=setup({person:{...person,userId:'me',self:true,position:null},viewer:'me',locateSelf});
  const pending=act(async()=>{void mock.day.onLocate();});
  await pending;
  view.rerender(<PersonMap person={{...person,userId:'him',name:'Sam'}} viewer="me" timeZone={Z} renderMap={renderMap} locateSelf={locateSelf}/>);
  await act(async()=>{resolve(here);await Promise.resolve();});
  expect(last().focus).toBeUndefined();expect(last().fitKey).toMatch(/^him\|/);
 });
 it('a Locate notice goes when the day changes, and overlapping taps are one request', async()=>{
  mock.empty=true;
  let resolve;const locateSelf=vi.fn(()=>new Promise(r=>{resolve=r;}));
  setup({person:{...person,userId:'me',self:true,position:null},viewer:'me',locateSelf});
  await act(async()=>{void mock.day.onLocate();});
  await act(async()=>{void mock.day.onLocate();});
  expect(locateSelf).toHaveBeenCalledTimes(1);
  expect(mock.day.locating).toBe(true);
  await act(async()=>{resolve(null);await Promise.resolve();});
  expect(screen.getByText(/location is not available/i)).toBeTruthy();
  control('pday:prev');
  expect(screen.queryByText(/location is not available/i)).toBeNull();
 });
});

it('selects only a visible activity, dims other routes, and clears its preview when access is withdrawn',()=>{
 const {view}=setup();
 act(()=>mock.onStep('not-authorised'));
 expect(screen.queryByLabelText('Selected activity')).toBeNull();
 act(()=>mock.onStep('b'));
 expect(screen.getByLabelText('Selected activity').textContent).toMatch(/Work to shops.*Driving/);
 expect(last().styled.find(r=>r.activityID==='b').width).toBe(5);
 expect(last().styled.find(r=>r.activityID==='a').opacity).toBe(0.55);
 expect(last().styled.find(r=>r.activityID==='b').points).toEqual([[-34.5,150.9],[-34.6,150.9]]);
 mock.empty=true;
 view.rerender(<PersonMap person={person} personPin={selectedPin} viewer="me" timeZone={Z} renderMap={renderMap}/>);
 expect(last().styled).toEqual([]);
 expect(screen.queryByLabelText('Selected activity')).toBeNull();
});
it('filters the person day in memory, clears selection and playback, and leaves the viewport scope alone',()=>{
 setup();const key=last().scope;
 act(()=>mock.onStep('b'));
 control('pday:activity:Walking');
 expect(last().styled).toEqual([]);
 expect(last().scope).toBe(key);
 expect(screen.queryByLabelText('Selected activity')).toBeNull();
 expect(screen.getByText('No activities match this filter.')).toBeTruthy();
 control('pday:reset');expect(last().styled).toHaveLength(2);
});
it('ignores a slow locate reply after changing dates',async()=>{
 let resolve;
 setup({locateSelf:()=>new Promise(r=>{resolve=r;})});
 await act(async()=>{void mock.day.onLocate();});control('pday:prev');
 await act(async()=>{resolve({latitude:-33,longitude:150});});
 expect(last().focus).toBeUndefined();
});
it('selecting an activity from the accessible list releases playback and highlights its saved route',async()=>{
 setup();
 fireEvent.change(screen.getByLabelText('Time of day'),{target:{value:String(Number(screen.getByLabelText('Time of day').min)+40)}});
 fireEvent.click(screen.getByRole('button',{name:/Work to shops ·/}));
 await act(async()=>{});
 expect(last().pins.some(p=>p.kind==='playback')).toBe(false);
 expect(last().styled.find(r=>r.activityID==='b').width).toBe(5);
});
it('selects an activity flag through the existing event and highlights the matching flag and preview',()=>{
 setup();act(()=>mock.onStep('b'));
 expect(last().pins.filter(p=>p.kind==='step').map(p=>[p.activityID,p.selected])).toEqual([['a',false],['b',true]]);
 expect(screen.getByLabelText('Selected activity').textContent).toContain('Work to shops');
 control('pday:activity:Walking');expect(last().pins.some(p=>p.kind==='step')).toBe(false);
 control('pday:reset');control('pday:prev');
 expect(last().pins.filter(p=>p.kind==='step').every(p=>!p.selected)).toBe(true);
});
it('labels the activity list with the same chronological numbers as the map flags',()=>{
 setup();
 expect(screen.getByRole('button',{name:/#1 · Home to work ·/})).toBeTruthy();
 expect(screen.getByRole('button',{name:/#2 · Work to shops ·/})).toBeTruthy();
 expect(last().pins.filter(p=>p.kind==='step').map(p=>p.label)).toEqual(['1','2']);
});
it('reveals the selected preview, including a repeated tap after scrolling back to the map',async()=>{
 const original=Element.prototype.scrollIntoView,scroll=vi.fn();Element.prototype.scrollIntoView=scroll;
 try{
  setup();act(()=>mock.onStep('a'));
  await waitFor(()=>expect(scroll).toHaveBeenCalledTimes(1));
  expect(scroll.mock.contexts[0]).toBe(screen.getByLabelText('Selected activity'));
  expect(scroll).toHaveBeenLastCalledWith(expect.objectContaining({block:'nearest'}));
  act(()=>mock.onStep('a'));
  await waitFor(()=>expect(scroll).toHaveBeenCalledTimes(2));
 }finally{if(original)Element.prototype.scrollIntoView=original;else delete Element.prototype.scrollIntoView;}
});
