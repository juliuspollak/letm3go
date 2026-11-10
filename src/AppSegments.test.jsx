import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import App from './App.jsx';
import {emptyRecorder} from './lib/recorder.js';
// Activities | Segments, the header without the location pin, the unread badge,
// and notifications opening the right place (20261126000000).
const {identity,recorderHook,mapProps,mapLocationHook,inbox,segmentsApi}=vi.hoisted(()=>({identity:{value:null},recorderHook:vi.fn(),mapLocationHook:vi.fn(),mapProps:{value:null},
 inbox:{items:[],markOneRead:null,markRead:null},segmentsApi:{listSegments:null,segmentDetail:null}}));
vi.mock('./lib/AuthContext.jsx',()=>({AuthProvider:({children})=>children,useAuth:()=>identity.value}));
vi.mock('./lib/config.js',()=>({config:{configured:false,appleEnabled:false,pushEnabled:false,teslaEnabled:false}}));
vi.mock('./lib/supabase.js',()=>({supabase:null}));
vi.mock('./lib/useCloudJourneyPage.js',()=>({useCloudJourneyPage:()=>({ids:[],loading:false,error:'',more:false,refresh:()=>{}})}));
vi.mock('./lib/useJourneyScope.js',()=>({useJourneyScope:()=>({loading:false,error:''})}));
vi.mock('./lib/useMapLocation.js',()=>({useMapLocation:mapLocationHook}));
vi.mock('./lib/useRecorder.js',()=>({useRecorder:recorderHook}));
vi.mock('./components/JourneyMap.jsx',()=>({default:props=>{mapProps.value=props;return <div aria-label="Interactive journey route map"/>;}}));
vi.mock('./lib/notifications.js',async original=>({...await original(),useNotifications:()=>({items:inbox.items,count:inbox.items.length,refresh:()=>{},markRead:inbox.markRead,markOneRead:inbox.markOneRead})}));
vi.mock('./lib/segmentsApi.js',async original=>({...await original(),listSegments:(...args)=>segmentsApi.listSegments(...args),segmentDetail:(...args)=>segmentsApi.segmentDetail(...args)}));

const segmentID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
beforeEach(()=>{
 mapLocationHook.mockReturnValue({position:null,loading:false,error:'',locate:vi.fn()});
 identity.value={status:'authenticated',session:{user:{id:'owner',email:'owner@example.com'}},preferences:{displayName:'Me',vehicles:[],onboardingComplete:true},
  savePreferences:vi.fn(async patch=>({...identity.value.preferences,...patch})),beginSignIn:vi.fn(),signOut:vi.fn(),retry:vi.fn()};
 recorderHook.mockReturnValue({state:emptyRecorder,run:vi.fn(),busy:false,error:''});
 inbox.items=[];inbox.markOneRead=vi.fn();inbox.markRead=vi.fn();
 segmentsApi.listSegments=vi.fn(async()=>[{id:segmentID,name:'Grove climb',activity:'MTB',distance_meters:400,creator_name:'Ann',mine:false,can_edit:false,status:'approved',visibility:'public',efforts:2}]);
 segmentsApi.segmentDetail=vi.fn(async id=>({id,name:'Grove climb',activity:'MTB',status:'approved',visibility:'public',deleted:false,geometry:[[-34.5,150.85],[-34.6,150.85]],distance_meters:400,created_at:'2026-11-01T00:00:00Z',creator_name:'Ann',mine:false,can_edit:false,stats:{efforts:2}}));
});
afterEach(()=>{cleanup();localStorage.clear();});
const flush=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});

it('the header keeps dark mode and the avatar, drops the location pin, and Social still has location sharing',()=>{
 render(<App/>);
 expect(screen.getByRole('button',{name:'Toggle dark theme'})).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Open profile'})).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Location sharing'})).toBeNull();
 fireEvent.click(screen.getAllByRole('button',{name:'Social',exact:true})[0]);
 expect(screen.getAllByText(/location/i).length).toBeGreaterThan(0);
});

it('Activities stays the default; Segments loads the community library only when chosen',async()=>{
 render(<App/>);
 fireEvent.click(screen.getAllByRole('button',{name:'Trips',exact:true})[0]);
 expect(screen.getByRole('button',{name:'Activities',pressed:true})).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Search all activities'})).toBeInTheDocument();
 await flush();
 expect(segmentsApi.listSegments).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Segments',pressed:false}));
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,350));});
 expect(segmentsApi.listSegments).toHaveBeenCalled();
 // The activity tools belong to Activities.
 expect(screen.queryByRole('button',{name:'Search all activities'})).toBeNull();
 fireEvent.click(await screen.findByRole('button',{name:'Open segment Grove climb'}));
 await flush();
 const sheet=screen.getByRole('dialog',{name:'Segment'});
 expect(within(sheet).getByRole('heading',{name:'Grove climb'})).toBeInTheDocument();
 expect(within(sheet).getByText(/Created by Ann/)).toBeInTheDocument();
});

it('shows the unread count on the avatar and lists notifications at the top of Profile; one opens its segment',async()=>{
 inbox.items=Array.from({length:12},(_,i)=>({id:i+1,kind:i===0?'segment_record':'segment_completed',title:i===0?'New record on your segment':`Completed ${i}`,body:'Grove climb',
  route:{screen:'segment',id:segmentID},created_at:'2026-11-10T01:00:00Z'}));
 render(<App/>);
 const avatar=screen.getByRole('button',{name:'Open profile, 12 new notifications'});
 expect(avatar.querySelector('.notification-badge')).toHaveTextContent('9+');
 fireEvent.click(avatar);
 const profile=screen.getByRole('dialog',{name:'Your profile'});
 const list=within(profile).getByRole('region',{name:'Notifications'});
 // Notifications come before the rest of Profile.
 expect(list.compareDocumentPosition(within(profile).getByRole('button',{name:/Feedback & Support/}))&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 fireEvent.click(within(list).getByRole('button',{name:/New record on your segment/}));
 expect(inbox.markOneRead).toHaveBeenCalledWith(1);
 await flush();
 expect(segmentsApi.segmentDetail).toHaveBeenCalledWith(segmentID);
 expect(screen.getByRole('dialog',{name:'Segment'})).toBeInTheDocument();
 // Behind the sheet, Activities shows Segments.
 expect(screen.getByRole('button',{name:'Segments',pressed:true})).toBeInTheDocument();
});

it('a segment tapped on the Map opens the same details',async()=>{
 render(<App/>);
 fireEvent.click(screen.getAllByRole('button',{name:'Map',exact:true})[0]);
 act(()=>mapProps.value.onControl('segments'));
 act(()=>mapProps.value.onSegment(segmentID));
 await flush();
 expect(segmentsApi.segmentDetail).toHaveBeenCalledWith(segmentID);
 expect(within(screen.getByRole('dialog',{name:'Segment'})).getByRole('heading',{name:'Grove climb'})).toBeInTheDocument();
});

it('Profile no longer has a separate My Segments or review entry',()=>{
 render(<App/>);
 fireEvent.click(screen.getByRole('button',{name:'Open profile'}));
 expect(screen.queryByRole('button',{name:/My Segments/})).toBeNull();
 expect(screen.queryByRole('button',{name:/to review/})).toBeNull();
});
