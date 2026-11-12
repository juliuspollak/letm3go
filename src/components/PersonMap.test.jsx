import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({payloads:[],onStep:null,dayArgs:[],rpc:vi.fn(),mounts:0}));
vi.mock('./AppleMap.jsx',async()=>{
 const {useEffect}=await import('react');
 function MockMap({payload,onStep}){mock.payloads.push(payload);mock.onStep=onStep;useEffect(()=>{mock.mounts++;},[]);return <div data-testid="map"/>;}
 return {default:MockMap};
});
vi.mock('./PersonAvatar.jsx',()=>({default:()=><span/>}));
vi.mock('../lib/supabase.js',()=>({supabase:{rpc:mock.rpc}}));
vi.mock('../lib/usePersonDay.js',async()=>{
 const {composeDay}=await import('../lib/personDay.js');
 const {dayWindow}=await import('../lib/dayWindow.js');
 return {usePersonDay:args=>{
  mock.dayArgs.push(args);
  const w=dayWindow(args.date,args.timeZone);
  const row=(id,t,title)=>({activity_id:id,title,activity:'Driving',started_at:new Date((w.start+t)*1000).toISOString(),ended_at:new Date((w.start+t+600)*1000).toISOString(),roads:{},
   points:[{latitude:-34.5,longitude:150.9,segment:0,t:w.start+t},{latitude:-34.6,longitude:150.9,segment:0,t:w.start+t+30},{latitude:-34.7,longitude:150.95,segment:1,t:w.start+t+600}]});
  const day=composeDay({date:args.date,timeZone:args.timeZone,now:Date.now()/1000,rows:[row('a',1000,'Home to work'),row('b',5000,'Work to shops')],
   live:{points:[[-34.8,151,w.start+8000,0],[-34.81,151,w.start+8060,0]],roads:{}}});
  return {day,loading:false,error:''};
 }};
});
import PersonMap from './PersonMap.jsx';
import AppleMap from './AppleMap.jsx';
import {dayKeyOf,addDays} from '../lib/dayWindow.js';

const Z='Australia/Sydney';
const person={userId:'her',name:'Julia',position:{latitude:-34.9,longitude:151.1},status:{text:'Sharing location · updated just now',tone:'live'}};
// The Map tab's one map, drawn by whoever renders PersonMap (JourneyMap in the app).
const renderMap=day=><AppleMap payload={day?.payload??{all:true}} onStep={day?.onStep}/>;
const setup=(over={})=>{
 const onOpenShared=vi.fn(),onPoke=vi.fn();
 const view=render(<PersonMap person={person} viewer="me" timeZone={Z} renderMap={renderMap} onOpenShared={onOpenShared} onPoke={onPoke} {...over}/>);
 return {onOpenShared,onPoke,view};
};
const last=()=>mock.payloads.at(-1);
afterEach(cleanup);
beforeEach(()=>{mock.mounts=0;mock.payloads.length=0;mock.dayArgs.length=0;mock.rpc.mockReset();});

describe('person map',()=>{
 it('shows the latest location, numbered activity markers and the live trail on today',()=>{
  setup();
  const pins=last().pins;
  expect(pins.filter(p=>p.kind==='step').map(p=>[p.label,p.title])).toEqual([['1','1. Home to work'],['2','2. Work to shops']]);
  expect(pins.find(p=>p.kind==='friend-live').title).toMatch(/Julia · Sharing location/);
  expect(last().live.length).toBe(2);
  expect(screen.getByText('Today')).toBeTruthy();
 });
 it('hands the map a stable identity and a fit key per day, so day changes update in place',()=>{
  setup();
  const today=dayKeyOf(Date.now()/1000,Z);
  expect(last().fitKey).toBe('her|'+today);
  fireEvent.click(screen.getByLabelText('Previous day'));
  expect(last().fitKey).toBe('her|'+addDays(today,-1));
 });
 it('opens the shared-activity detail of the right person and activity from a marker, leaving the map in place',()=>{
  const {onOpenShared}=setup();
  act(()=>mock.onStep('b'));
  expect(onOpenShared).toHaveBeenCalledWith('b',{userId:'her',name:'Julia'});
  expect(screen.getByTestId('map')).toBeTruthy();
 });
 it('still shows the person\'s activities when they are not sharing a live position, and invents no location', ()=>{
  setup({person:{...person,position:null,status:{text:'Not sharing live location',tone:'stale'}}});
  expect(mock.dayArgs.at(-1).enabled).toBe(true);
  expect(last().pins.filter(p=>p.kind==='step')).toHaveLength(2);
  expect(last().pins.some(p=>p.kind==='friend-live')).toBe(false);
  expect(screen.getByText('Not sharing live location')).toBeTruthy();
 });
 it('shows the same single map for All people, without a person bar or any day loading',()=>{
  setup({person:null});
  expect(last()).toEqual({all:true});
  expect(screen.queryByLabelText('Previous day')).toBeNull();
  expect(screen.queryByText('Poke')).toBeNull();
  expect(mock.dayArgs.at(-1).enabled).toBe(false);
 });
 it('switches person and goes back to All people on the one mounted map', ()=>{
  const {view}=setup({person:null});
  const props={viewer:'me',timeZone:Z,renderMap,onPoke:vi.fn()};
  view.rerender(<PersonMap person={person} {...props}/>);
  expect(last().fitKey).toMatch(/^her\|/);
  view.rerender(<PersonMap person={{...person,userId:'him',name:'Sam'}} {...props}/>);
  expect(last().fitKey).toMatch(/^him\|/);
  expect(mock.dayArgs.at(-1).owner).toBe('him');
  view.rerender(<PersonMap person={null} {...props}/>);
  expect(last()).toEqual({all:true});
  expect(mock.mounts).toBe(1); // the map was updated in place, never re-created
 });
 it('starts a newly selected person at Today with the slider released', ()=>{
  const {view}=setup();
  fireEvent.click(screen.getByLabelText('Previous day'));
  const props={viewer:'me',timeZone:Z,renderMap,onPoke:vi.fn()};
  view.rerender(<PersonMap person={{...person,userId:'him',name:'Sam'}} {...props}/>);
  expect(mock.dayArgs.at(-1).date).toBe(dayKeyOf(Date.now()/1000,Z));
 });
 it('moves between days without leaving the map, and cannot go past today',()=>{
  setup();
  const today=dayKeyOf(Date.now()/1000,Z);
  expect(screen.getByLabelText('Next day').disabled).toBe(true);
  fireEvent.click(screen.getByLabelText('Previous day'));
  expect(mock.dayArgs.at(-1).date).toBe(addDays(today,-1));
  expect(screen.getByText('Yesterday')).toBeTruthy();
  // The latest-location pin and live trail belong to today only.
  expect(last().pins.some(p=>p.kind==='friend-live')).toBe(false);expect(last().live).toEqual([]);
  fireEvent.click(screen.getByLabelText('Next day'));
  expect(mock.dayArgs.at(-1).date).toBe(today);
 });
 it('scrubs entirely in memory: a playback marker, no network, and the line stops at that time',()=>{
  setup();
  const slider=screen.getByLabelText('Time of day');
  const before=last().routes.length;
  fireEvent.change(slider,{target:{value:String(Number(slider.min)+1)}});
  const marker=last().pins.find(p=>p.kind==='playback');
  expect(marker).toBeTruthy();expect(marker.title).toMatch(/Recorded at/);
  expect(last().pins.some(p=>p.kind==='friend-live')).toBe(true); // the live marker stays distinct
  expect(last().live).toEqual([]);expect(last().estimated).toEqual([]);
  expect(last().routes.length).toBeLessThanOrEqual(before);
  expect(mock.rpc).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Back to now'));
  expect(last().pins.some(p=>p.kind==='playback')).toBe(false);
 });
 it('says so, instead of inventing a point, when the slider is inside a GPS gap',()=>{
  setup();
  const slider=screen.getByLabelText('Time of day');
  // Between the 2nd and 3rd fix of the first activity there is a segment break.
  fireEvent.change(slider,{target:{value:String(Number(slider.min)+450)}});
  expect(last().pins.find(p=>p.kind==='playback').title).toMatch(/No GPS signal/);
  expect(screen.getByText(/No GPS signal · last recorded fix shown/)).toBeTruthy();
 });
 it('left open on Today past midnight, moves on to the new day; a day the person picked stays put',()=>{
  vi.useFakeTimers();
  try{
   vi.setSystemTime(new Date('2026-11-10T12:59:30Z')); // 23:59:30 in Sydney
   setup();
   expect(mock.dayArgs.at(-1).date).toBe('2026-11-10');
   act(()=>{vi.advanceTimersByTime(61000);});
   expect(mock.dayArgs.at(-1).date).toBe('2026-11-11');
   expect(screen.getByText('Today')).toBeTruthy();
   expect(last().pins.some(p=>p.kind==='friend-live')).toBe(true);
   fireEvent.click(screen.getByLabelText('Previous day'));
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
  expect(screen.getByText(/not on this phone/)).toBeTruthy();
 });
 it('on my own map, an activity on this phone opens locally',()=>{
  const open=vi.fn(()=>true);
  render(<PersonMap person={{...person,userId:'me'}} viewer="me" timeZone={Z} onOpenOwn={open} renderMap={renderMap}/>);
  act(()=>mock.onStep('a'));
  expect(open).toHaveBeenCalledWith('a');
 });
 it('words a position inside a GPS gap without repeating itself',()=>{
  setup();
  const slider=screen.getByLabelText('Time of day');
  fireEvent.change(slider,{target:{value:String(Number(slider.min)+450)}});
  expect(last().pins.find(p=>p.kind==='playback').title).not.toMatch(/ago earlier|just now earlier/);
 });
 it('offers a discreet Poke that only pokes, and none on my own map', ()=>{
  const {onPoke,onOpenShared}=setup();
  fireEvent.click(screen.getByLabelText('Poke Julia'));
  expect(onPoke).toHaveBeenCalledTimes(1);expect(onOpenShared).not.toHaveBeenCalled();
  cleanup();
  render(<PersonMap person={{...person,userId:'me'}} viewer="me" timeZone={Z} renderMap={renderMap} onPoke={vi.fn()}/>);
  expect(screen.queryByLabelText(/^Poke/)).toBeNull();
 });
 it('confirms a poke quietly in the person bar', ()=>{
  setup({poke:{state:'sent'}});
  expect(screen.getByText('Poked ✓')).toBeTruthy();
 });
});
