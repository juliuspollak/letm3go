import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import PeopleGrid,{PeopleSkeleton} from './PeopleGrid.jsx';

afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
const person=over=>({id:'p',userId:'p',name:'Julia',location:{state:'live',ageSeconds:50},...over});
const grid=person=><PeopleGrid people={[person]} label="People"/>;
const avatar=()=>screen.getByRole('img',{name:'Julia avatar'}).closest('.person-tile-avatar');
const travel=()=>screen.getByRole('button',{name:/Next travel estimate/});
const times={driveSeconds:780,walkSeconds:2280,cycleSeconds:720};

it('keeps Map, Wave and the travel control as independent touch targets',()=>{
 const open=vi.fn(),poke=vi.fn();
 const {container}=render(grid(person({...times,onSelect:open,onPoke:poke})));
 expect(container.querySelector('button button')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:/Show Julia on the map/}));
 expect(open).toHaveBeenCalledOnce();
 expect(poke).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Wave to Julia'}));
 fireEvent.click(travel());
 expect(poke).toHaveBeenCalledOnce();
 expect(open).toHaveBeenCalledOnce();
 expect(travel()).toHaveAccessibleName(/Walking/);
});

it.each([
 [{state:'live',home:true,homeSeconds:4500},'current',null,/At home.*Since 1h 15 min ago/],
 [{state:'stale',verifiedHome:true,ageSeconds:1260},'last-known','21m ago',/Last verified at home.*21 min ago/],
])('shows the house inside the photo with freshness for a last known home', (location,ring,age,description)=>{
 render(grid(person({location,...times})));
 expect(avatar()).toHaveAttribute('data-location',ring);
 expect(within(avatar()).getByRole('img',{name:description}).querySelector('.lucide-house')).toBeInTheDocument();
 expect(avatar().querySelector('.person-freshness')?.textContent??null).toBe(age);
 expect(avatar().querySelector('.person-travel')).toBeNull();
});

it.each([
 ['waiting','Waiting for location','.lucide-clock-3'],
 ['unknown','No recent location','.lucide-map-pin-off'],
 ['off','Not sharing','.lucide-shield-off'],
])('distinguishes %s even when cached travel times are supplied',(state,label,icon)=>{
 render(grid(person({location:{state},...times})));
 expect(avatar()).toHaveAttribute('data-location','unavailable');
 expect(screen.getByRole('img',{name:label}).querySelector(icon)).toBeInTheDocument();
 expect(avatar().querySelector('.person-travel')).toBeNull();
});

it('shows a pin when located with no valid estimate and preserves the actual activity in details',()=>{
 render(grid(person({location:{state:'live',activity:'Driving'},driveSeconds:-1,walkSeconds:NaN,onSelect:vi.fn()})));
 expect(screen.getByRole('button',{name:/Show Julia on the map.*Driving/})).toBeInTheDocument();
 expect(screen.getByRole('img',{name:/Driving/}).querySelector('.lucide-map-pin')).toBeInTheDocument();
 expect(avatar().querySelector('.person-travel')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Location details for Julia'}));
 expect(screen.getByRole('dialog',{name:'Julia'})).toHaveTextContent('Driving');
});

it('crossfades all four estimates in the same overlay and explains the last known destination',()=>{
 vi.useFakeTimers();
 render(grid(person({location:{state:'stale',ageSeconds:1260,lastKnownActivity:'Driving'},...times,onSelect:vi.fn()})));
 const photo=avatar(),overlay=travel();
 for(const [mode,text] of [['Driving','13m'],['Walking','38m'],['Cycling','12m'],['Snail','26d']]){
  expect(avatar()).toBe(photo);
  expect(travel()).toBe(overlay);
  expect(overlay).toHaveAccessibleName(new RegExp(mode+'.*last known location'));
  expect(overlay.querySelector('[data-active="true"]')).toHaveTextContent(text);
  act(()=>vi.advanceTimersByTime(3000));
 }
 expect(within(photo).getByText('21m ago')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Location details for Julia'}));
 const dialog=screen.getByRole('dialog',{name:'Julia'});
 expect(dialog).toHaveTextContent('Last activity: Driving');
 expect(dialog).toHaveTextContent('Estimated travel to last known location');
 expect(within(dialog).getAllByRole('listitem')).toHaveLength(4);
 fireEvent.keyDown(dialog,{key:'Escape'});
 expect(screen.queryByRole('dialog')).toBeNull();
 expect(screen.getByRole('button',{name:'Location details for Julia'})).toHaveFocus();
});

it('formats hour-plus travel estimates without adding a mode label',()=>{
 render(grid(person({driveSeconds:4800})));
 const estimate=screen.getByRole('img',{name:'Driving: 1 h 20 min to current location'});
 expect(estimate).toHaveTextContent('1h 20m');
});

it('draws a refresh arc on the same ring while keeping the photo and estimate',()=>{
 render(grid(person({...times,refreshLabel:'Refreshing…'})));
 const ring=avatar().querySelector('.person-ring');
 const track=ring.querySelector('.person-ring-track');
 const arc=ring.querySelector('.person-refresh-arc');
 for(const attribute of ['cx','cy','r'])expect(arc.getAttribute(attribute)).toBe(track.getAttribute(attribute));
 expect(screen.getByRole('img',{name:'Julia avatar'})).toBeInTheDocument();
 expect(travel()).toHaveAccessibleName(/Driving/);
});

it('holds the estimate in reduced motion and still lets the viewer select another mode',()=>{
 vi.useFakeTimers();
 vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
 render(grid(person(times)));
 act(()=>vi.advanceTimersByTime(12000));
 expect(travel()).toHaveAccessibleName(/Driving.*current location/);
 fireEvent.click(travel());
 expect(travel()).toHaveAccessibleName(/Walking/);
 act(()=>vi.advanceTimersByTime(12000));
 expect(travel()).toHaveAccessibleName(/Walking/);
});

it.each([
 ['New location','new','A newer location was received.'],
 ['No new location','unchanged','No new location received. Showing the last known location.'],
 ['Request failed','failed','The location refresh request could not be sent.'],
 ['Couldn’t check','unchecked','Could not verify whether a newer location was received.'],
])('keeps the photo and travel during refresh and explains %s',(result,ring,message)=>{
 const open=vi.fn(),selected=person({...times,location:{state:'stale',ageSeconds:1260},onSelect:open});
 const {rerender}=render(grid({...selected,refreshLabel:'Refreshing…'}));
 const photo=screen.getByRole('img',{name:'Julia avatar'});
 expect(avatar()).toHaveAttribute('data-refresh','refreshing');
 expect(travel()).toBeInTheDocument();
 rerender(grid({...selected,refreshLabel:result}));
 expect(screen.getByRole('img',{name:'Julia avatar'})).toBe(photo);
 expect(avatar()).toHaveAttribute('data-refresh',ring);
 expect(screen.getAllByRole('status').some(el=>el.textContent===`Julia: ${result}`)).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:/Show refresh details/}));
 expect(screen.getByRole('dialog')).toHaveTextContent(message);
 expect(open).not.toHaveBeenCalled();
});

it('renders the refresh title before native dialog focus moves inside',()=>{
 const {container}=render(grid(person({refreshLabel:'Request failed'})));
 const dialog=container.querySelector('dialog');
 dialog.showModal=vi.fn(()=>expect(dialog.querySelector('h2')).toHaveTextContent('Julia’s location refresh'));
 fireEvent.click(screen.getByRole('button',{name:/Show refresh details/}));
 expect(dialog.showModal).toHaveBeenCalledOnce();
});

it('explains a refresh with no new observation when there is no previous location',()=>{
 render(grid(person({location:{state:'waiting'},refreshLabel:'No new location'})));
 fireEvent.click(screen.getByRole('button',{name:/Show refresh details/}));
 expect(screen.getByRole('dialog')).toHaveTextContent('There is no previous location to show.');
});

it('keeps Wave feedback alongside incoming Wave and refresh, and offers retry after failure',()=>{
 const onPoke=vi.fn();
 const view=state=>grid(person({onPoke,receivedPoke:true,poke:{state,message:'Slow down'},refreshLabel:'Request failed'}));
 const {rerender}=render(view('sending'));
 for(const [state,label] of [['sending',/Sending wave/],['sent',/Wave sent/]]){
  rerender(view(state));
  const wave=screen.getByRole('button',{name:label});
  expect(wave).toHaveAttribute('aria-disabled','true');
  expect(wave).toHaveAccessibleName(/Julia waved at you/);
  fireEvent.click(wave);
 }
 expect(onPoke).not.toHaveBeenCalled();
 rerender(view('failed'));
 expect(avatar()).toHaveAttribute('data-refresh','failed');
 fireEvent.click(screen.getByRole('button',{name:/Wave to Julia failed.*Slow down.*Try again/}));
 expect(onPoke).toHaveBeenCalledOnce();
});

it('shows one placeholder per loading tile',()=>{
 render(<PeopleSkeleton/>);
 const list=screen.getByRole('status',{name:'Loading friends'});
 expect(list).toHaveAttribute('aria-busy','true');
 expect(list.querySelectorAll('li')).toHaveLength(3);
});
