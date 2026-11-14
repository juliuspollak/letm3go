import {act,cleanup,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({empty:false,error:'',loading:false,payloads:[],onStep:null,day:null,dayArgs:[],rpc:vi.fn(),mounts:0}));
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
  return {day,loading:mock.loading,error:mock.error};
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
beforeEach(()=>{mock.empty=false;mock.error='';mock.loading=false;mock.mounts=0;mock.payloads.length=0;mock.dayArgs.length=0;mock.day=null;mock.rpc.mockReset();});

describe('person map activity bubble',()=>{
 it('passes pending and failed day reads to the native map surface',()=>{
  mock.loading=true;const {view}=setup();expect(last().status).toBe('Loading…');
  mock.loading=false;mock.error='Could not load this day.';
  view.rerender(<PersonMap person={person} viewer="me" timeZone={Z} renderMap={renderMap}/>);
  expect(last().status).toBe('Could not load this day.');
 });
 it('shows chronological flags and visible routes without a list, slider or preview below the map',()=>{
  setup();expect(last().pins.filter(p=>p.kind==='step').map(p=>p.label)).toEqual(['1','2']);
  expect(last().styled.every(r=>r.width===3.5)).toBe(true);
  expect(screen.queryByRole('slider')).toBeNull();
  expect(document.querySelector('details,.person-map-preview,.person-map-timeline,.person-map-activities')).toBeNull();
  expect(last().activityPreview).toBeNull();
 });
 it('selects a route/flag into the same native bubble with basic information and authorised detail navigation',()=>{
  const {onOpenShared}=setup();act(()=>mock.onStep('b'));
  expect(last().activityPreview).toMatchObject({activityID:'b',title:'Work to shops',symbol:'car'});
  expect(last().activityPreview.detail).toMatch(/Driving.*10m.*recorded/);
  expect(last().styled.find(r=>r.activityID==='b').width).toBe(4.5);
  control('pday:open:b');expect(onOpenShared).toHaveBeenCalledWith('b',{userId:'her',name:'Julia'},{fullscreen:false});
 });
 it('ignores unknown flags and stale Open/Close events from another activity',()=>{
  const {onOpenShared}=setup();act(()=>mock.onStep('unknown'));expect(last().activityPreview).toBeNull();
  act(()=>mock.onStep('a'));control('pday:open:b');control('pday:clear:b');
  expect(onOpenShared).not.toHaveBeenCalled();expect(last().activityPreview.activityID).toBe('a');
  control('pday:clear:a');expect(last().activityPreview).toBeNull();
 });
 it('opens my own detail using the existing local activity callback',()=>{
  const open=vi.fn(()=>true);setup({person:{...person,userId:'me'},onOpenOwn:open});
  act(()=>mock.onStep('a'));control('pday:open:a');expect(open).toHaveBeenCalledWith('a',{fullscreen:false});
 });
 it('retains fullscreen origin when the native bubble opens an activity',()=>{
  const {onOpenShared}=setup();act(()=>mock.onStep('a'));control('pday:open-fullscreen:a');
  expect(onOpenShared).toHaveBeenCalledWith('a',{userId:'her',name:'Julia'},{fullscreen:true});
 });
 it('reports an own activity not available on this phone instead of opening someone else’s detail',()=>{
  setup({person:{...person,userId:'me'},onOpenOwn:()=>false});act(()=>mock.onStep('a'));control('pday:open:a');
  expect(screen.getByText(/not on this phone/)).toBeTruthy();
  expect(last().activityPreview.detail).toMatch(/not on this phone/);
  act(()=>mock.onStep('b'));expect(last().activityPreview.detail).not.toMatch(/not on this phone/);
 });
 it('clears the bubble when authorised geometry is withdrawn',()=>{
  const {view}=setup();act(()=>mock.onStep('b'));mock.empty=true;
  view.rerender(<PersonMap person={person} viewer="me" timeZone={Z} renderMap={renderMap}/>);
  expect(last().activityPreview).toBeNull();expect(last().styled).toEqual([]);
 });
 it('keeps live avatar parity, filters out groups and omits current locations on historical days',()=>{
  const {view}=setup();expect(last().pins.find(p=>p.kind==='people')).toBe(selectedPin);
  control('pday:prev');expect(last().pins.some(p=>p.kind==='people')).toBe(false);expect(last().live).toEqual([]);
  view.rerender(<PersonMap person={person} personPin={{...selectedPin,members:[...selectedPin.members,{id:'other'}]}} viewer="me" timeZone={Z} renderMap={renderMap}/>);
  control('pday:today');expect(last().pins.some(p=>p.kind==='people')).toBe(false);
 });
 it('filters only the loaded person day and clears selection without changing camera scope',()=>{
  setup();const scope=last().scope;act(()=>mock.onStep('a'));control('pday:activity:Walking');
  expect(last().activityPreview).toBeNull();expect(last().styled).toEqual([]);expect(last().scope).toBe(scope);
  control('pday:reset');expect(last().styled).toHaveLength(2);
 });
 it('clears selection when changing dates and keeps the same mounted map',()=>{
  setup();act(()=>mock.onStep('a'));const today=dayKeyOf(Date.now()/1000,Z);control('pday:prev');
  expect(last().fitKey).toBe('her|'+addDays(today,-1));expect(last().activityPreview).toBeNull();expect(mock.mounts).toBe(1);
 });
 it('preserves a supplied parent-owned day and activity selection on remount',()=>{
  const date=addDays(dayKeyOf(Date.now()/1000,Z),-1);
  setup({viewState:{owner:'her',picked:date,selected:'b',activity:'',notice:'',locate:null},onViewChange:vi.fn()});
  expect(last().fitKey).toBe('her|'+date);expect(last().activityPreview.activityID).toBe('b');
 });
 it('returns the same map slot for All people without loading a person day',()=>{
  setup({person:null});expect(last()).toEqual({all:true});expect(mock.day).toBeNull();expect(mock.dayArgs.at(-1).enabled).toBe(false);
 });
 it('keeps Locate pointed at my own current location in another person’s day',async()=>{
  const locateSelf=vi.fn(async()=>({latitude:-33.8,longitude:151.2}));setup({locateSelf});await locate();
  expect(locateSelf).toHaveBeenCalledTimes(1);expect(last().focus).toEqual([-33.8,151.2]);
 });
 it('frames someone’s current location when their day has no route to frame',()=>{
  mock.empty=true;setup();expect(last().focus).toEqual(selectedPin.point);
 });
 it('leaves the framing to the day’s routes when there are routes',()=>{
  setup();expect(last().focus).toBeUndefined();
 });
 it('marks me on someone else’s map after Locate, so the spot is recognisable',async()=>{
  const selfPin={id:'people:self',kind:'people',point:[-33.8,151.2],title:'You',members:[{id:'self',name:'You',self:true}]};
  setup({selfPin,locateSelf:async()=>({latitude:-33.8,longitude:151.2})});
  expect(last().pins.some(p=>p.id==='people:self')).toBe(false);
  await locate();expect(last().pins.some(p=>p.id==='people:self')).toBe(true);
 });
 it('ignores a slow Locate reply after date navigation',async()=>{
  let resolve;setup({locateSelf:()=>new Promise(r=>{resolve=r;})});await act(async()=>{void mock.day.onLocate();});
  control('pday:prev');await act(async()=>{resolve({latitude:-33,longitude:150});});expect(last().focus).toBeUndefined();
 });
 it('reports unavailable own location without inventing a point',async()=>{
  setup({locateSelf:async()=>null});await locate();expect(last().focus).toBeUndefined();expect(screen.getByText(/Your location is not available/)).toBeTruthy();
 });
});
