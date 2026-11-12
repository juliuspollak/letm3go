import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import App from './App.jsx';
import {emptyRecorder} from './lib/recorder.js';
// Person selection lives on the Map tab: Home hands over to it, the one map is updated in place,
// and Poke is a separate button on the Home tile.
const {identity,recorderHook,mapProps,mapLocationHook,friends,pokes,dayCalls,locateFn}=vi.hoisted(()=>({identity:{value:null},recorderHook:vi.fn(),mapLocationHook:vi.fn(),mapProps:{value:null,mounts:0},friends:{people:[]},pokes:{send:null},dayCalls:[],locateFn:vi.fn()}))
vi.mock('./lib/AuthContext.jsx',()=>({AuthProvider:({children})=>children,useAuth:()=>identity.value}));
vi.mock('./lib/config.js',()=>({config:{configured:false,appleEnabled:false,pushEnabled:false,teslaEnabled:false}}));
vi.mock('./lib/supabase.js',()=>({supabase:null}));
vi.mock('./lib/useCloudJourneyPage.js',()=>({useCloudJourneyPage:()=>({ids:[],loading:false,error:'',more:false,refresh:()=>{}})}));
vi.mock('./lib/useJourneyScope.js',()=>({useJourneyScope:()=>({loading:false,error:''})}));
vi.mock('./lib/useMapLocation.js',()=>({useMapLocation:mapLocationHook}));
vi.mock('./lib/useRecorder.js',()=>({useRecorder:recorderHook}));
vi.mock('./lib/useFriendLocations.js',()=>({useFriendLocations:()=>({people:friends.people,enabled:true,error:'',ready:true,lastSentAt:0,setEnabled:()=>{},refresh:()=>{}})}));
vi.mock('./lib/usePersonDay.js',async()=>{
 const {composeDay}=await import('./lib/personDay.js');
 return {usePersonDay:args=>{dayCalls.push(args);return {day:composeDay({rows:[],live:null,timeZone:args.timeZone,date:args.date,now:Date.now()/1000}),loading:false,error:''};}};
});
vi.mock('./components/JourneyMap.jsx',async()=>{
 const {useEffect}=await import('react');
 function MockJourneyMap(props){mapProps.value=props;useEffect(()=>{mapProps.mounts++;},[]);return <div aria-label="Interactive journey route map"/>;}
 return {default:MockJourneyMap};
});
vi.mock('./lib/notifications.js',async original=>({...await original(),sendPoke:(...args)=>pokes.send(...args),useNotifications:()=>({items:[],count:0,refresh:()=>{},markRead:vi.fn(),markOneRead:vi.fn()})}));

const ann={user_id:'ann',display_name:'Ann',latitude:-34.5,longitude:150.9,updated_at:new Date().toISOString(),accuracy:10};
beforeEach(()=>{
 mapProps.value=null;mapProps.mounts=0;dayCalls.length=0;
 friends.people=[ann];pokes.send=vi.fn(async()=>({}));
 locateFn.mockReset();locateFn.mockResolvedValue({latitude:-33.8,longitude:151.2});
 mapLocationHook.mockReturnValue({position:null,loading:false,error:'',locate:locateFn});
 identity.value={status:'authenticated',session:{user:{id:'owner',email:'owner@example.com'}},preferences:{displayName:'Me',vehicles:[],onboardingComplete:true},
  savePreferences:vi.fn(),beginSignIn:vi.fn(),signOut:vi.fn(),retry:vi.fn()};
 recorderHook.mockReturnValue({state:emptyRecorder,run:vi.fn(),busy:false,error:''});
});
afterEach(()=>{cleanup();localStorage.clear();});
const trigger=()=>screen.getByRole('button',{name:/^Showing /});
const choose=async name=>{fireEvent.click(trigger());fireEvent.click(within(screen.getByRole('dialog',{name:'Choose who to show'})).getByRole('button',{name}));};
const lastOwner=()=>dayCalls.filter(c=>c.enabled).at(-1)?.owner;
const mapSettings=()=>JSON.stringify(Object.entries(localStorage).sort());

it('tapping a person on Home opens the Map tab on that person, with no second map over Home', ()=>{
 render(<App/>);
 fireEvent.click(screen.getByLabelText(/Show Ann on the Map/));
 expect(screen.getByLabelText('Interactive journey route map')).toBeInTheDocument();
 expect(trigger().getAttribute('aria-label')).toMatch(/^Showing Ann/);
 expect(lastOwner()).toBe('ann');
 expect(mapProps.value.personDay.payload.fitKey).toMatch(/^ann\|/);
 expect(document.querySelector('.person-map')).toBeNull();
});
it('My day selects me on the same Map', ()=>{
 render(<App/>);
 fireEvent.click(screen.getByRole('button',{name:'My day'}));
 expect(trigger().getAttribute('aria-label')).toMatch(/^Showing Me/);
 expect(lastOwner()).toBe('owner');
});
it('the Map is the map first: no permanent notice, no friends row, no list of people, no person card, no legend text', async()=>{
 render(<App/>);
 fireEvent.click(screen.getAllByRole('button',{name:'Map',exact:true})[0]);
 expect(screen.queryByText(/Map shows loaded activities/)).toBeNull();
 expect(screen.queryByText(/friends’ journeys/i)).toBeNull();
 expect(screen.queryByText('Kim')).toBeNull();expect(screen.queryByText('Ann')).toBeNull();
 await choose(/Ann/);
 expect(screen.queryByText(/Solid lines/)).toBeNull();
 expect(screen.queryByRole('button',{name:/^Poke/})).toBeNull();
 expect(document.querySelector('.person-map-head')).toBeNull();
});
it('Friends\' journeys is a Layers option; toggling it does not touch the saved Map settings', ()=>{
 render(<App/>);
 fireEvent.click(screen.getAllByRole('button',{name:'Map',exact:true})[0]);
 act(()=>mapProps.value.onControl('panel:layers'));
 const option=()=>mapProps.value.controls.panel.sections.flatMap(s=>s.options).find(o=>o.id==='social');
 expect(option().selected).toBe(false);
 const before=mapSettings();
 act(()=>mapProps.value.onControl('social'));
 expect(option().selected).toBe(true);
 expect(mapSettings()).toBe(before);
});
it('keeps the Layers toolbar for a person (JourneyMap limits it to map style), and the Friends\' journeys setting for when All people returns', ()=>{
 render(<App/>);
 fireEvent.click(screen.getAllByRole('button',{name:'Map',exact:true})[0]);
 act(()=>mapProps.value.onControl('social'));
 act(()=>mapProps.value.onControl('panel:layers'));
 fireEvent.click(trigger());fireEvent.click(within(screen.getByRole('dialog',{name:'Choose who to show'})).getByRole('button',{name:/Ann/}));
 expect(mapProps.value.personDay).toBeTruthy();
 fireEvent.click(trigger());fireEvent.click(within(screen.getByRole('dialog',{name:'Choose who to show'})).getByRole('button',{name:/All people/}));
 // The Layers panel stayed open throughout.
 const social=mapProps.value.controls.panel.sections.flatMap(s=>s.options).find(o=>o.id==='social');
 expect(social.selected).toBe(true);
});
it('switches person from the selector, restores All people, never remounts the map and leaves the saved settings alone', async()=>{
 render(<App/>);
 fireEvent.click(screen.getByLabelText(/Show Ann on the Map/));
 const mounts=mapProps.mounts,before=mapSettings();
 await choose(/^Me/);
 expect(lastOwner()).toBe('owner');
 await choose(/Ann/);
 expect(lastOwner()).toBe('ann');
 await choose(/All people/);
 expect(mapProps.value.personDay).toBeNull();
 expect(mapProps.value.journeys).toBeDefined();
 expect(mapProps.mounts).toBe(mounts);
 expect(trigger().getAttribute('aria-label')).toMatch(/^Showing All people/);
 expect(mapSettings()).toBe(before);
});
it('Locate always goes to my own location across All people, Me and another person', async()=>{
 render(<App/>);
 fireEvent.click(screen.getAllByRole('button',{name:'Map',exact:true})[0]);
 await act(async()=>{await mapProps.value.onLocate();});
 expect(locateFn).toHaveBeenCalledTimes(1);
 await choose(/^Me/);
 locateFn.mockClear();
 await act(async()=>{await mapProps.value.personDay.onLocate();});
 expect(locateFn).toHaveBeenCalledTimes(1);
 expect(mapProps.value.personDay.payload.focus).toEqual([-33.8,151.2]);
 await choose(/Ann/);
 locateFn.mockClear();
 await act(async()=>{await mapProps.value.personDay.onLocate();});
 expect(locateFn).toHaveBeenCalledTimes(1);
 expect(mapProps.value.personDay.payload.focus).toEqual([-33.8,151.2]);
});
it('Poke is a separate button: one request, the tile does not open the Map, and it goes back to Poke', async()=>{
 vi.useFakeTimers({shouldAdvanceTime:true});
 try{
  render(<App/>);
  const button=screen.getByRole('button',{name:'Poke Ann'});
  await act(async()=>{fireEvent.click(button);fireEvent.click(button);});
  expect(pokes.send).toHaveBeenCalledTimes(1);expect(pokes.send).toHaveBeenCalledWith('ann');
  expect(screen.queryByRole('button',{name:/^Showing /})).toBeNull(); // still on Home
  expect(screen.getByRole('button',{name:'Poked Ann'})).toHaveTextContent('✓ Poked');
  await act(async()=>{vi.advanceTimersByTime(2600);});
  expect(screen.getByRole('button',{name:'Poke Ann'})).toHaveTextContent('👋 Poke');
 }finally{vi.useRealTimers();}
});
it('a tap on the person does not poke, and a failed poke offers a retry', async()=>{
 render(<App/>);
 fireEvent.click(screen.getByLabelText(/Show Ann on the Map/));
 expect(pokes.send).not.toHaveBeenCalled();
 cleanup();
 pokes.send=vi.fn().mockRejectedValueOnce(new Error('Slow down')).mockResolvedValue({});
 render(<App/>);
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Poke Ann'}));});
 const retry=screen.getByRole('button',{name:/failed: Slow down/});
 expect(retry).toHaveTextContent('Retry poke');
 await act(async()=>{fireEvent.click(retry);});
 expect(pokes.send).toHaveBeenCalledTimes(2);
 expect(screen.getByRole('button',{name:'Poked Ann'})).toBeInTheDocument();
});
it('shows the compact status line on the tile', ()=>{
 render(<App/>);
 expect(document.querySelector('.person-tile-status').textContent).toMatch(/just now|\dm ago/);
 expect(document.querySelector('.person-tile-status').textContent).not.toMatch(/Sharing ·|away/);
});
it('leaving the Map returns to All people', ()=>{
 render(<App/>);
 fireEvent.click(screen.getByLabelText(/Show Ann on the Map/));
 fireEvent.click(screen.getAllByRole('button',{name:'Home',exact:true})[0]);
 fireEvent.click(screen.getAllByRole('button',{name:'Map',exact:true})[0]);
 expect(trigger().getAttribute('aria-label')).toMatch(/^Showing All people/);
});
it('a Filters panel left open is closed when a person is chosen, and stays closed on return', async()=>{
 render(<App/>);
 fireEvent.click(screen.getAllByRole('button',{name:'Map',exact:true})[0]);
 act(()=>mapProps.value.onControl('panel:filters'));
 expect(mapProps.value.controls.panel?.id).toBe('filters');
 await choose(/Ann/);
 await choose(/All people/);
 expect(mapProps.value.controls.panel).toBeNull();
});
