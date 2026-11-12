import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import App from './App.jsx';
import {emptyRecorder} from './lib/recorder.js';
// Person selection lives on the Map tab: Home hands over to it, the one map is updated in place,
// and Poke is a separate action (Home ••• menu, person bar).
const {identity,recorderHook,mapProps,mapLocationHook,friends,pokes,dayCalls}=vi.hoisted(()=>({identity:{value:null},recorderHook:vi.fn(),mapLocationHook:vi.fn(),mapProps:{value:null,mounts:0},friends:{people:[]},pokes:{send:null},dayCalls:[]}));
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
 mapLocationHook.mockReturnValue({position:null,loading:false,error:'',locate:vi.fn()});
 identity.value={status:'authenticated',session:{user:{id:'owner',email:'owner@example.com'}},preferences:{displayName:'Me',vehicles:[],onboardingComplete:true},
  savePreferences:vi.fn(),beginSignIn:vi.fn(),signOut:vi.fn(),retry:vi.fn()};
 recorderHook.mockReturnValue({state:emptyRecorder,run:vi.fn(),busy:false,error:''});
});
afterEach(()=>{cleanup();localStorage.clear();});
const selector=()=>screen.getByRole('group',{name:'Show on map'});
const lastOwner=()=>dayCalls.filter(c=>c.enabled).at(-1)?.owner;

it('tapping a person on Home opens the Map tab on that person, with no second map over Home', ()=>{
 render(<App/>);
 expect(document.querySelector('.person-map')).toBeNull();
 fireEvent.click(screen.getByLabelText(/Show Ann on the Map/));
 expect(screen.getByLabelText('Interactive journey route map')).toBeInTheDocument();
 expect(within(selector()).getByRole('button',{name:/Ann/}).getAttribute('aria-pressed')).toBe('true');
 expect(lastOwner()).toBe('ann');
 expect(mapProps.value.personDay.payload.fitKey).toMatch(/^ann\|/);
 expect(document.querySelector('.person-map')).toBeNull();
});
it('My day selects me on the same Map', ()=>{
 render(<App/>);
 fireEvent.click(screen.getByRole('button',{name:'My day'}));
 expect(within(selector()).getByRole('button',{name:'Me'}).getAttribute('aria-pressed')).toBe('true');
 expect(lastOwner()).toBe('owner');
});
it('switches person, changes back to All people and keeps one mounted map, without touching the saved Map settings', ()=>{
 render(<App/>);
 fireEvent.click(screen.getByLabelText(/Show Ann on the Map/));
 const mounts=mapProps.mounts;
 fireEvent.click(within(selector()).getByRole('button',{name:'Me'}));
 expect(lastOwner()).toBe('owner');
 fireEvent.click(within(selector()).getByRole('button',{name:/Ann/}));
 expect(lastOwner()).toBe('ann');
 fireEvent.click(within(selector()).getByRole('button',{name:'All people'}));
 expect(mapProps.value.personDay).toBeNull();
 expect(mapProps.value.journeys).toBeDefined();
 expect(mapProps.mounts).toBe(mounts);
 expect(within(selector()).getByRole('button',{name:'All people'}).getAttribute('aria-pressed')).toBe('true');
});
it('Poke from the Home ••• menu does not navigate, and a tap on the person does not poke', async()=>{
 render(<App/>);
 fireEvent.click(screen.getByLabelText('More actions for Ann'));
 await act(async()=>{fireEvent.click(screen.getByRole('menuitem',{name:'Poke Ann'}));});
 expect(pokes.send).toHaveBeenCalledWith('ann');
 expect(screen.queryByRole('group',{name:'Show on map'})).toBeNull();
 expect(screen.getByText('Poked ✓')).toBeInTheDocument();
 pokes.send.mockClear();
 fireEvent.click(screen.getByLabelText(/Show Ann on the Map/));
 expect(pokes.send).not.toHaveBeenCalled();
});
it('pokes from the Map person bar without changing the selection', async()=>{
 render(<App/>);
 fireEvent.click(screen.getByLabelText(/Show Ann on the Map/));
 await act(async()=>{fireEvent.click(screen.getByLabelText('Poke Ann'));});
 expect(pokes.send).toHaveBeenCalledWith('ann');
 expect(lastOwner()).toBe('ann');
});
it('leaving the Map returns to All people', ()=>{
 render(<App/>);
 fireEvent.click(screen.getByLabelText(/Show Ann on the Map/));
 fireEvent.click(screen.getAllByRole('button',{name:'Home',exact:true})[0]);
 fireEvent.click(screen.getAllByRole('button',{name:'Map',exact:true})[0]);
 expect(within(selector()).getByRole('button',{name:'All people'}).getAttribute('aria-pressed')).toBe('true');
});
