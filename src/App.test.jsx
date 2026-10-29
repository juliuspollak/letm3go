import { act, render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App.jsx';
import { demoJourneys } from './test/fixtures/journeys.js';
import { emptyRecorder } from './lib/recorder.js';
const { identity, recorderHook, mapProps }=vi.hoisted(()=>({identity:{value:null},recorderHook:vi.fn(),mapProps:{value:null}}));
vi.mock('./lib/AuthContext.jsx',()=>({AuthProvider:({children})=>children,useAuth:()=>identity.value}));
vi.mock('./lib/config.js',()=>({config:{configured:false,appleEnabled:false,pushEnabled:false,teslaEnabled:false}}));
vi.mock('./lib/supabase.js',()=>({supabase:null}));
vi.mock('./lib/useRecorder.js',()=>({useRecorder:recorderHook}));
vi.mock('./components/JourneyMap.jsx',()=>({default:props=>{mapProps.value=props;return <div aria-label="Interactive journey route map"/>;}}));
beforeEach(()=>{identity.value={status:'signedOut',session:null,preferences:{displayName:'',vehicles:[],onboardingStep:0,onboardingComplete:false},savePreferences:vi.fn(async patch=>({...identity.value.preferences,...patch})),beginSignIn:vi.fn(),signOut:vi.fn(),retry:vi.fn()};recorderHook.mockReturnValue({state:emptyRecorder,run:vi.fn(),busy:false,error:''});});
afterEach(()=>{cleanup();localStorage.clear();window.history.replaceState({},'','/');});
function signedIn(){identity.value={...identity.value,status:'authenticated',session:{user:{id:'owner',email:'owner@example.com'}},preferences:{...identity.value.preferences,onboardingComplete:true}};}
it('requires authentication before accessing any private screens or the native recorder',()=>{
 render(<App/>);expect(screen.getByRole('heading',{name:'Welcome to Letm3go.'})).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Start activity'})).not.toBeInTheDocument();expect(recorderHook).not.toHaveBeenCalled();
 expect(screen.getByRole('button',{name:'Sign in with Apple'})).toBeDisabled();
});
it('shows profile onboarding after first authentication rather than Home',()=>{
 signedIn();identity.value.preferences.onboardingComplete=false;render(<App/>);
 expect(screen.getByRole('heading',{name:'What should we call you?'})).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Open profile'})).not.toBeInTheDocument();
});
it('keeps demonstration routes and photos out of the real application',()=>{signedIn();render(<App/>);expect(screen.getByText('No device recordings yet.')).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Browse labelled demo journeys'})).not.toBeInTheDocument();for(const fixture of demoJourneys)expect(screen.queryByText(fixture.title)).not.toBeInTheDocument();});
it('restores returning users to Home and keeps browser GPS unavailable',()=>{
 signedIn();render(<App/>);fireEvent.click(screen.getByRole('button',{name:'Start activity'}));expect(screen.getByRole('button',{name:'Start walking'})).toBeDisabled();
});
it('shows native recorder load failures instead of presenting an unexplained empty history',()=>{
 signedIn();recorderHook.mockReturnValue({state:emptyRecorder,run:vi.fn(),busy:false,error:'Private activity storage could not be read.'});render(<App/>);
 expect(screen.getByRole('alert')).toHaveTextContent('Private activity storage could not be read.');
});
it('keeps private screens locked while restoring or reauthenticating',()=>{
 identity.value.status='restoring';const {rerender}=render(<App/>);expect(screen.getByRole('status')).toHaveTextContent('Restoring');expect(recorderHook).not.toHaveBeenCalled();
 identity.value.status='reauth';rerender(<App/>);expect(screen.getByRole('heading',{name:'Welcome to Letm3go.'})).toBeInTheDocument();expect(recorderHook).not.toHaveBeenCalled();
});

it('permits deliberately public journey links without mounting private recording',async()=>{
 window.history.replaceState({},'', '/?journey=11111111-1111-4111-8111-111111111111');render(<App/>);
 expect(await screen.findByRole('heading',{name:/unavailable or has been revoked/})).toBeInTheDocument();expect(recorderHook).not.toHaveBeenCalled();
});
it('opens Tracking & Permissions from Profile through Account settings',()=>{signedIn();render(<App/>);fireEvent.click(screen.getByRole('button',{name:'Open profile'}));fireEvent.click(screen.getByRole('button',{name:'Account & settings'}));fireEvent.click(screen.getByRole('button',{name:'Tracking & Permissions'}));expect(screen.getByRole('heading',{name:'Tracking & Permissions'})).toBeInTheDocument();expect(screen.getByRole('switch',{name:'Automatic Tracking'})).toBeInTheDocument();});
it('keeps the activity list in Trips rather than duplicating it on Home and Map',()=>{signedIn();recorderHook.mockReturnValue({state:{...emptyRecorder,trips:[{id:'trip',source:'device',title:'Walk to park',activity:'Walking',startedAt:100,endedAt:200,durationSeconds:100,distanceMeters:100,points:[],details:{}}]},run:vi.fn(),busy:false,error:''});render(<App/>);expect(screen.queryByRole('button',{name:'Open Walk to park'})).not.toBeInTheDocument();expect(screen.queryByLabelText('Interactive journey route map')).not.toBeInTheDocument();fireEvent.click(screen.getAllByRole('button',{name:'Trips',exact:true})[0]);expect(screen.getByRole('button',{name:'Open Walk to park'})).toBeInTheDocument();fireEvent.click(screen.getAllByRole('button',{name:'Map',exact:true})[0]);expect(screen.getByLabelText('Interactive journey route map')).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Open Walk to park'})).not.toBeInTheDocument();expect(screen.queryByText('Recorded paths')).not.toBeInTheDocument();});
it('opens today-only Trips from Home metrics and allows returning to all dates',()=>{signedIn();const date=new Date();date.setHours(12,0,0,0);const previous=new Date(date);previous.setDate(date.getDate()-1);const trip=(id,title,at)=>({id,title,source:'device',activity:'Walking',startedAt:at.getTime()/1000,endedAt:at.getTime()/1000+60,durationSeconds:60,distanceMeters:100,points:[],details:{}});recorderHook.mockReturnValue({state:{...emptyRecorder,trips:[trip('today','Today walk',date),trip('previous','Yesterday walk',previous)]},run:vi.fn(),busy:false,error:''});render(<App/>);fireEvent.click(screen.getByRole('button',{name:/Activities today: 1/}));expect(screen.getByRole('button',{name:'Open Today walk'})).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Open Yesterday walk'})).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Today',exact:true})).toHaveAttribute('aria-pressed','true');fireEvent.click(screen.getByRole('button',{name:'All',exact:true}));expect(screen.getByRole('button',{name:'Open Yesterday walk'})).toBeInTheDocument();});

it('filters favourites and saves the star without opening the trip',()=>{
 signedIn();identity.value.preferences.bookmarks=['first'];
 const trip=(id,title)=>({id,title,source:'device',activity:'Walking',startedAt:100,endedAt:200,durationSeconds:100,distanceMeters:100,points:[],details:{}});
 recorderHook.mockReturnValue({state:{...emptyRecorder,trips:[trip('first','Park'),trip('second','Shop')]},run:vi.fn(),busy:false,error:''});
 render(<App/>);fireEvent.click(screen.getAllByRole('button',{name:'Trips',exact:true})[0]);
 expect(screen.getByRole('button',{name:'Remove from favourites: Park'})).toHaveAttribute('aria-pressed','true');
 fireEvent.click(screen.getByRole('button',{name:'Add to favourites: Shop'}));
 expect(identity.value.savePreferences).toHaveBeenCalledWith({bookmarks:['first','second']});
 expect(screen.getByRole('button',{name:'Open Shop'})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Favourites',exact:true}));
 expect(screen.getByRole('button',{name:'Open Park'})).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Open Shop'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Favourites',exact:true}));
 expect(screen.getByRole('button',{name:'Open Shop'})).toBeInTheDocument();
});

it('opens distinct Home distance, duration and activity views with numeric sorting',()=>{
 signedIn();const now=Date.now()/1000;
 const trip=(id,title,offset,distance,duration)=>({id,title,source:'device',activity:'Walking',startedAt:now-offset,endedAt:now-offset+duration,durationSeconds:duration,distanceMeters:distance,points:[],details:{}});
 recorderHook.mockReturnValue({state:{...emptyRecorder,trips:[trip('long','Longest distance',1200,10000,600),trip('slow','Longest time',600,2000,1200),trip('new','Newest trip',0,1000,60)]},run:vi.fn(),busy:false,error:''});
 render(<App/>);
 const titles=()=>screen.getAllByRole('button',{name:/^Open (Longest|Newest)/}).map(button=>button.getAttribute('aria-label'));
 fireEvent.click(screen.getByRole('button',{name:/Today's distance:/}));
 const filtersButton=screen.getByRole('button',{name:'Activity filters'});
 if(filtersButton.getAttribute('aria-expanded')!=='true')fireEvent.click(filtersButton);
 expect(screen.getByRole('combobox',{name:'Sort trips'})).toHaveValue('distance');
 expect(titles()).toEqual(['Open Longest distance','Open Longest time','Open Newest trip']);
 fireEvent.click(screen.getAllByRole('button',{name:'Home',exact:true})[0]);
 fireEvent.click(screen.getByRole('button',{name:/Recorded time:/}));
 const reopenedFiltersButton=screen.getByRole('button',{name:'Activity filters'});
 if(reopenedFiltersButton.getAttribute('aria-expanded')!=='true')fireEvent.click(reopenedFiltersButton);
 expect(screen.getByRole('combobox',{name:'Sort trips'})).toHaveValue('duration');
 expect(titles()).toEqual(['Open Longest time','Open Longest distance','Open Newest trip']);
 expect(screen.getByText('Today · 31 min recorded · Longest first')).toBeInTheDocument();
 fireEvent.click(screen.getAllByRole('button',{name:'Home',exact:true})[0]);
 fireEvent.click(screen.getByRole('button',{name:/Activities today:/}));
 expect(titles()).toEqual(['Open Newest trip','Open Longest time','Open Longest distance']);
});
it('shows one grouped journey and finds it through an intermediate locality search',()=>{
 signedIn();identity.value.preferences.vehicles=[{id:'kia',name:'Kia'}];
 const at=Date.now()/1000-36000,p=(lat,lon,time)=>({latitude:lat,longitude:lon,timestamp:time,accuracy:5,segment:0});
 const raw=(id,start,end,from,to)=>({id,title:id,source:'device',activity:'Driving',state:'finished',vehicle:'Kia',startedAt:start,endedAt:end,durationSeconds:end-start,distanceMeters:100000,points:[from,to],details:{}});
 const a=raw('a',at,at+3600,p(-33.8,151.2,at),p(-31.6,152.7,at+3600));
 const b=raw('b',at+5700,at+9300,p(-31.6,152.7,at+5700),p(-28,153.4,at+9300));
 identity.value.preferences.journeyGrouping=JSON.stringify({version:1,owner:'owner',links:[],cuts:[],history:[],titles:{},stopEdits:{},places:{'-33.8000,151.2000':{locality:'Sydney'},'-31.6000,152.7000':{locality:'Kew'},'-28.0000,153.4000':{locality:'Gold Coast'}}});
 recorderHook.mockReturnValue({state:{...emptyRecorder,trips:[a,b]},run:vi.fn(),busy:false,error:''});
 render(<App/>);fireEvent.click(screen.getAllByRole('button',{name:'Trips',exact:true})[0]);
 fireEvent.click(screen.getByRole('button',{name:'Search all activities'}));
 fireEvent.change(screen.getByRole('searchbox',{name:'Search all activity history'}),{target:{value:'Kew'}});
 expect(screen.getByRole('button',{name:'Open Driving to Gold Coast'})).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Open a'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Open Driving to Gold Coast'}));expect(screen.getByRole('heading',{name:'Segments & stops'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'Rename journey'})).toBeInTheDocument();expect(screen.getAllByText('Kew',{exact:true}).length).toBeGreaterThan(0);
});

it('assigns a vehicle from a trip card without leaving the activity list',async()=>{
 signedIn();const now=Date.now()/1000;
 identity.value.preferences.vehicles=[{id:'car-1',name:'Geely',category:'car'},{id:'bike-1',name:'Trek',category:'bicycle'}];
 const raw=(id,title,equipment)=>({id,title,source:'device',activity:'Driving',state:'finished',recordingMode:'manual',startedAt:now-3600,endedAt:now-3000,durationSeconds:600,distanceMeters:24600,points:[],equipment,details:{}});
 const run=vi.fn().mockResolvedValue({trips:[raw('geely','Geely drive',[{id:'car-1',name:'Geely'}])]});
 recorderHook.mockReturnValue({state:{...emptyRecorder,trips:[raw('geely','Geely drive'),raw('kia','Kia drive',[{id:'car-1',name:'Geely'}])]},run,busy:false,error:''});
 render(<App/>);fireEvent.click(screen.getAllByRole('button',{name:'Trips',exact:true})[0]);
 expect(screen.getByRole('button',{name:'Equipment: Geely. Change equipment'})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Add equipment to Geely drive'}));
 expect(screen.getByRole('heading',{name:'What did you use it with?'})).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Use Trek'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Use Geely'}));
 await waitFor(()=>expect(run).toHaveBeenCalledWith('assignEquipment',{id:'geely',ids:['car-1']}));
});

it('filters trips by equipment and clears the filter again',()=>{
 signedIn();const now=Date.now()/1000;
 identity.value.preferences.vehicles=[{id:'car-1',name:'Geely',category:'car'},{id:'bike-1',name:'Trek',category:'bicycle'}];
 const raw=(id,title,equipment)=>({id,title,source:'device',activity:'Driving',state:'finished',recordingMode:'manual',startedAt:now-3600,endedAt:now-3000,durationSeconds:600,distanceMeters:1000,points:[],equipment,details:{}});
 recorderHook.mockReturnValue({state:{...emptyRecorder,trips:[raw('geely','Geely drive',[{id:'car-1',name:'Geely'}]),raw('kia','Unassigned drive')]},run:vi.fn(),busy:false,error:''});
 render(<App/>);fireEvent.click(screen.getAllByRole('button',{name:'Trips',exact:true})[0]);
 fireEvent.click(screen.getByRole('button',{name:'Activity filters'}));
 fireEvent.change(screen.getByRole('combobox',{name:'Filter by equipment'}),{target:{value:'car-1'}});
 expect(screen.getByRole('button',{name:'Open Geely drive'})).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Open Unassigned drive'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Remove equipment filter Geely'}));
 expect(screen.getByRole('button',{name:'Open Unassigned drive'})).toBeInTheDocument();
 fireEvent.change(screen.getByRole('combobox',{name:'Filter by equipment'}),{target:{value:'car-1'}});
 fireEvent.change(screen.getByRole('combobox',{name:'Filter activities'}),{target:{value:'Cycling'}});
 expect(screen.queryByRole('button',{name:'Open Geely drive'})).not.toBeInTheDocument();
});

it('keeps an archived drive searchable by the equipment it used',()=>{
 signedIn();const now=Date.now()/1000;
 localStorage.setItem('letm3go:archived-trips:owner',JSON.stringify(['geely']));
 identity.value.preferences.vehicles=[{id:'car-1',name:'Geely',category:'car'}];
 const raw=(id,title,equipment)=>({id,title,source:'device',activity:'Driving',state:'finished',recordingMode:'manual',startedAt:now-3600,endedAt:now-3000,durationSeconds:600,distanceMeters:1000,points:[],equipment,details:{}});
 recorderHook.mockReturnValue({state:{...emptyRecorder,trips:[raw('geely','Geely drive',[{id:'car-1',name:'Geely'}]),raw('kia','Other drive')]},run:vi.fn(),busy:false,error:''});
 render(<App/>);fireEvent.click(screen.getAllByRole('button',{name:'Trips',exact:true})[0]);
 fireEvent.click(screen.getByRole('button',{name:'Activity filters'}));
 fireEvent.change(screen.getByRole('combobox',{name:'Filter by equipment'}),{target:{value:'car-1'}});
 fireEvent.click(screen.getByRole('button',{name:'Archived activities (1)'}));
 expect(screen.getByRole('button',{name:'Open Geely drive'})).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Open Other drive'})).not.toBeInTheDocument();
});

it('opens the trips that used a Collection item with the filter applied',()=>{
 signedIn();const now=Date.now()/1000;
 identity.value.preferences.vehicles=[{id:'car-1',name:'Geely',category:'car'}];
 const raw=(id,title)=>({id,title,source:'device',activity:'Driving',state:'finished',recordingMode:'manual',startedAt:now-3600,endedAt:now-3000,durationSeconds:600,distanceMeters:1000,points:[],equipment:[{id:'car-1',name:'Geely'}],details:{}});
 recorderHook.mockReturnValue({state:{...emptyRecorder,trips:[raw('one','First Geely drive'),raw('two','Second Geely drive')]},run:vi.fn(),busy:false,error:''});
 render(<App/>);fireEvent.click(screen.getByRole('button',{name:'Open profile'}));fireEvent.click(screen.getByRole('button',{name:'My Collection'}));
 fireEvent.click(screen.getByRole('button',{name:'View Geely'}));
 fireEvent.click(screen.getByRole('button',{name:'View 2 activities'}));
 expect(screen.getByRole('button',{name:'Open First Geely drive'})).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Remove equipment filter Geely'})).toBeInTheDocument();
});

it('counts a provisional journey in today totals and last activity',()=>{
  signedIn();const now=Date.now()/1000;
  const provisional={id:'prov',title:'Drive home',source:'device',activity:'Driving',state:'paused',recordingMode:'automatic',startedAt:now-3600,endedAt:now-3300,durationSeconds:600,distanceMeters:5900,ownerID:'owner',points:[{latitude:-33,longitude:151,timestamp:now-3600,segment:0},{latitude:-32.9,longitude:151,timestamp:now-3300,segment:0}],details:{provisional:true}};
  recorderHook.mockReturnValue({state:{...emptyRecorder,ownerID:'owner',trips:[provisional],automaticEnabled:true},run:vi.fn(),busy:false,error:''});
  render(<App/>);
  expect(screen.getByRole('button',{name:/Today's distance: 5.9 km/})).toBeInTheDocument();
  expect(screen.getByRole('button',{name:/Activities today: 1/})).toBeInTheDocument();
  expect(screen.getByRole('button',{name:/Drive home/})).toBeInTheDocument();
});


it('opens the Map showing everyone, map first, rather than centring on the signed-in user',()=>{
 signedIn();render(<App/>);
 fireEvent.click(screen.getAllByRole('button',{name:'Map',exact:true})[0]);
 expect(screen.getByLabelText('Interactive journey route map')).toBeInTheDocument();
 expect(mapProps.value.camera).toMatchObject({key:'people:owner',mode:'all',personId:null});
 expect(mapProps.value.focusPoint).toBeUndefined();
 expect(screen.queryByText('Your world, mapped.')).not.toBeInTheDocument();
 expect(screen.queryByText('Go somewhere. Keep the feeling.')).not.toBeInTheDocument();
 // One Layers control instead of a toolbar of toggles above the map.
 expect(screen.queryByRole('button',{name:/My routes/})).not.toBeInTheDocument();
 expect(screen.queryByRole('group',{name:'Map filters'})).not.toBeInTheDocument();
 expect(mapProps.value.onLayers).toEqual(expect.any(Function));
 expect(mapProps.value.overview).toBeNull();
 // A gesture reported by the native map is kept when the tab is left and reopened.
 const command=mapProps.value.camera.command;
 act(()=>mapProps.value.onCamera({mode:'free',personId:null,command}));
 expect(mapProps.value.camera).toMatchObject({mode:'free',command});
 fireEvent.click(screen.getAllByRole('button',{name:'Home',exact:true})[0]);
 fireEvent.click(screen.getAllByRole('button',{name:'Map',exact:true})[0]);
 expect(mapProps.value.camera).toMatchObject({mode:'free',command});
 // Routes are drawn as a density overview, never as Start/Finish pins per journey.
 act(()=>mapProps.value.onLayers());
 const sheet=screen.getByRole('dialog',{name:'Map layers'});
 fireEvent.click(within(sheet).getByRole('button',{name:'All routes'}));
 expect(within(sheet).getByRole('button',{name:'All routes'})).toHaveAttribute('aria-pressed','true');
 expect(within(sheet).getByRole('switch',{name:'People & places'})).toHaveAttribute('aria-checked','true');
 expect(mapProps.value.camera).toMatchObject({includeRoutes:mapProps.value.overview!==null});
 // Choosing the other map closes the sheet; Community trails has no people camera.
 fireEvent.click(within(sheet).getByRole('radio',{name:'Community trails'}));
 expect(screen.queryByRole('dialog',{name:'Map layers'})).not.toBeInTheDocument();
 expect(screen.queryByLabelText('Interactive journey route map')).not.toBeInTheDocument();
 // The choice is kept across tabs.
 fireEvent.click(screen.getAllByRole('button',{name:'Home',exact:true})[0]);
 fireEvent.click(screen.getAllByRole('button',{name:'Map',exact:true})[0]);
 expect(screen.queryByLabelText('Interactive journey route map')).not.toBeInTheDocument();
});
