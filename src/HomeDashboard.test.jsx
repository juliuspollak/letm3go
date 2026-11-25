import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import App from './App.jsx';
import {emptyRecorder} from './lib/recorder.js';
// The compact Home: header (with the recording status), one Today card with the first and last activities of the day shown, Friends.
const {identity,recorderHook,mapLocationHook,friends,requestLocations}=vi.hoisted(()=>({identity:{value:null},recorderHook:vi.fn(),mapLocationHook:vi.fn(),friends:{people:[],refresh:vi.fn()},requestLocations:vi.fn().mockResolvedValue(0)}));
vi.mock('./lib/AuthContext.jsx',()=>({AuthProvider:({children})=>children,useAuth:()=>identity.value}));
vi.mock('./lib/config.js',()=>({config:{configured:false,appleEnabled:false,pushEnabled:false,teslaEnabled:false}}));
vi.mock('./lib/supabase.js',()=>({supabase:null}));
vi.mock('./lib/locationRefresh.js',async importOriginal=>({...await importOriginal(),requestSharedLocations:requestLocations}));
vi.mock('./lib/useCloudJourneyPage.js',()=>({useCloudJourneyPage:()=>({ids:[],loading:false,error:'',more:false,refresh:()=>{}})}));
vi.mock('./lib/useJourneyScope.js',()=>({useJourneyScope:()=>({loading:false,error:''})}));
vi.mock('./lib/useMapLocation.js',()=>({useMapLocation:mapLocationHook}));
vi.mock('./lib/useRecorder.js',()=>({useRecorder:recorderHook}));
vi.mock('./lib/useFriendLocations.js',()=>({useFriendLocations:()=>({people:friends.people,enabled:true,error:'',ready:true,lastSentAt:0,setEnabled:()=>{},refresh:friends.refresh})}));
vi.mock('./components/JourneyMap.jsx',()=>({default:()=><div aria-label="Interactive journey route map"/>}));

const at=(daysAgo,hour,minute=0)=>{const d=new Date();d.setDate(d.getDate()-daysAgo);d.setHours(hour,minute,0,0);return d.getTime()/1000;};
const trip=(id,title,started,over={})=>({id,title,source:'device',activity:'Walking',startedAt:started,endedAt:started+1080,durationSeconds:1080,distanceMeters:4000,points:[],details:{},...over});
const setup=(trips,over={})=>{
 identity.value={status:'authenticated',session:{user:{id:'owner',email:'o@example.com'}},preferences:{displayName:'Me',vehicles:[],onboardingComplete:true},savePreferences:vi.fn(),beginSignIn:vi.fn(),signOut:vi.fn(),retry:vi.fn()};
 recorderHook.mockReturnValue({state:{...emptyRecorder,trips,...over},run:vi.fn(),busy:false,error:''});
 return render(<App/>);
};
beforeEach(()=>{mapLocationHook.mockReturnValue({position:null,loading:false,error:'',locate:vi.fn()});friends.people=[];requestLocations.mockClear();friends.refresh.mockClear();});
afterEach(()=>{cleanup();localStorage.clear();});
const card=()=>screen.getByRole('region',{name:'Daily activity summary'});

it('refreshes shared locations when pulling down from the top of Home',async()=>{
 setup([]);
 friends.refresh.mockClear();
 const heading=screen.getByRole('heading',{name:'Your day. Your way.'});
 const pull=target=>{
  fireEvent.touchStart(target,{touches:[{clientX:30,clientY:120}]});
  fireEvent.touchEnd(target,{touches:[],changedTouches:[{clientX:33,clientY:210}]});
 };
 pull(heading);
 await waitFor(()=>expect(friends.refresh).toHaveBeenCalledOnce());
 expect(screen.queryByRole('button',{name:'Refresh locations'})).toBeNull();
 await waitFor(()=>expect(screen.queryByText('Refreshing locations…')).toBeNull());
 fireEvent.click(within(screen.getByRole('navigation',{name:'Sections'})).getByRole('button',{name:'Social'}));
 expect(screen.queryByRole('button',{name:'Refresh locations'})).toBeNull();
 pull(screen.getByRole('heading',{name:'Your people.'}));
 expect(friends.refresh).toHaveBeenCalledOnce();
});

it('updates a friend with a fresh shared position and preserves another friend’s age',async()=>{
 const old=new Date(Date.now()-22*60*1000).toISOString();
 const point={latitude:-34.5,longitude:150.9,updated_at:old};
 friends.people=[{...point,user_id:'ann',display_name:'Ann'},{...point,user_id:'kim',display_name:'Kim'}];
 friends.refresh.mockImplementationOnce(async()=>{
  friends.people=[{...friends.people[0],updated_at:new Date().toISOString()},friends.people[1]];
 });
 const {rerender}=setup([]);
 const tile=name=>screen.getByRole('img',{name:`${name} avatar`}).closest('.person-tile');
 const heading=screen.getByRole('heading',{name:'Your day. Your way.'});
 expect(tile('Ann')).toHaveTextContent('22m ago');
 expect(tile('Kim')).toHaveTextContent('22m ago');
 fireEvent.touchStart(heading,{touches:[{clientX:30,clientY:120}]});
 fireEvent.touchEnd(heading,{touches:[],changedTouches:[{clientX:33,clientY:210}]});
 expect(requestLocations).toHaveBeenCalledWith(['ann','kim']);
 expect(tile('Ann')).toHaveTextContent('Refreshing…');
 await waitFor(()=>expect(screen.queryByText('Refreshing locations…')).toBeNull());
 rerender(<App/>);
 expect(tile('Ann').querySelector('.person-freshness')).toBeNull();
 expect(tile('Ann')).toHaveTextContent('New location');
 expect(tile('Kim')).toHaveTextContent('No new location');
 expect(within(tile('Kim')).getByRole('img',{name:'Kim avatar'})).toBeInTheDocument();
 expect(within(tile('Ann')).getByRole('img',{name:'Ann avatar'})).toBeInTheDocument();
 expect(tile('Kim')).toHaveTextContent('22m ago');
});

it('shows which tiles were affected when the server rejects the refresh request',async()=>{
 const point={latitude:-34.5,longitude:150.9,updated_at:new Date(Date.now()-22*60*1000).toISOString()};
 friends.people=[{...point,user_id:'ann',display_name:'Ann'},{...point,user_id:'kim',display_name:'Kim'}];
 requestLocations.mockRejectedValueOnce(new Error('RPC missing'));
 setup([]);
 const heading=screen.getByRole('heading',{name:'Your day. Your way.'});
 fireEvent.touchStart(heading,{touches:[{clientX:30,clientY:120}]});
 fireEvent.touchEnd(heading,{touches:[],changedTouches:[{clientX:33,clientY:210}]});
 expect(await screen.findByText('Could not send location requests.')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:/Ann: Request failed/}).closest('.person-tile')).toHaveTextContent('22m ago');
 expect(screen.getByRole('button',{name:/Kim: Request failed/}).closest('.person-tile')).toHaveTextContent('22m ago');
});

it('allows a queued check-in time to get a fix before reading back locations',async()=>{
 vi.useFakeTimers();
 try{
  friends.people=[{user_id:'ann',display_name:'Ann',latitude:-34.5,longitude:150.9,updated_at:new Date().toISOString()}];
  requestLocations.mockResolvedValueOnce(1);
  setup([]);
  const heading=screen.getByRole('heading',{name:'Your day. Your way.'});
  await act(async()=>{
   fireEvent.touchStart(heading,{touches:[{clientX:30,clientY:120}]});
   fireEvent.touchEnd(heading,{touches:[],changedTouches:[{clientX:33,clientY:210}]});
  });
  await act(()=>vi.advanceTimersByTimeAsync(20000));
  expect(friends.refresh).not.toHaveBeenCalled();
  expect(screen.getByLabelText(/Show Ann on the Map/).closest('.person-tile')).toHaveTextContent('Refreshing…');
  await act(()=>vi.advanceTimersByTimeAsync(5000));
  expect(friends.refresh).toHaveBeenCalledOnce();
  const avatar=screen.getByLabelText(/Show Ann on the Map/).closest('.person-tile-avatar');
  expect(avatar).toHaveAttribute('data-refresh','unchanged');
  expect(avatar).toHaveAttribute('data-location','current');
  expect(avatar.querySelector('.person-freshness')).toBeNull();
 }finally{
  vi.useRealTimers();
 }
});

it('reconciles a delayed observation after a read failure and starts a fresh baseline on the next pull',async()=>{
 const point={user_id:'ann',display_name:'Ann',latitude:-34.5,longitude:150.9,updated_at:new Date(Date.now()-22*60*1000).toISOString()};
 friends.people=[point];
 friends.refresh.mockRejectedValueOnce(new Error('Read failed'));
 const {rerender}=setup([]);
 const heading=screen.getByRole('heading',{name:'Your day. Your way.'});
 const pull=()=>{
  fireEvent.touchStart(heading,{touches:[{clientX:30,clientY:120}]});
  fireEvent.touchEnd(heading,{touches:[],changedTouches:[{clientX:33,clientY:210}]});
 };
 pull();
 expect(await screen.findByRole('button',{name:/Ann: Couldn’t check/})).toBeInTheDocument();
 friends.people=[{...point,updated_at:new Date().toISOString()}];
 rerender(<App/>);
 expect(screen.getByRole('button',{name:/Ann: New location/})).toBeInTheDocument();
 pull();
 expect(screen.queryByRole('button',{name:/Ann: New location/})).toBeNull();
 expect(await screen.findByRole('button',{name:/Ann: No new location/})).toBeInTheDocument();
 expect(requestLocations).toHaveBeenCalledTimes(2);
});

it('toggles the theme and keeps the theme button pressed state in sync',()=>{
 setup([]);
 const toggle=screen.getByRole('button',{name:'Toggle dark theme',pressed:false});
 fireEvent.click(toggle);
 expect(toggle).toHaveAttribute('aria-pressed','true');
 const burst=toggle.querySelector('.theme-toggle-burst');
 expect(burst).toBeInTheDocument();
 expect(document.documentElement).toHaveAttribute('data-theme','dark');
 fireEvent.click(toggle);
 expect(toggle).toHaveAttribute('aria-pressed','false');
 expect(toggle.querySelector('.theme-toggle-burst')).not.toBe(burst);
 expect(document.documentElement).toHaveAttribute('data-theme','light');
});

it('keeps the heading and subheading, with no separate Last activity card and no duplicated activity', ()=>{
 setup([trip('a','Morning walk',at(0,8,15))]);
 expect(screen.getByRole('heading',{name:'Your day. Your way.',level:1})).toBeTruthy();
 expect(screen.getByText('A little movement. A little perspective. Your day at a glance.')).toBeTruthy();
 expect(screen.queryByText(/YOUR DAY, OUT THERE/)).toBeNull();
 expect(screen.queryByRole('heading',{name:'Last activity'})).toBeNull();
 expect(screen.getAllByText('Morning walk')).toHaveLength(1); // only in the Today card
});
it('orders the page: header with recording status, heading, Today card, Friends', ()=>{
 friends.people=[{user_id:'ann',display_name:'Ann',latitude:-34.5,longitude:150.9,updated_at:new Date().toISOString(),accuracy:10}];
 const {container}=setup([trip('a','Morning walk',at(0,8,15))],{recordingHealth:{status:'ready'}});
 const header=container.querySelector('.topbar');
 expect(within(header).getByRole('button',{name:/Recording status/})).toBeTruthy();
 const order=[header,screen.getByRole('heading',{name:'Your day. Your way.'}),card(),screen.getByRole('heading',{name:'Friends'})];
 for(let i=1;i<order.length;i++)expect(order[i-1].compareDocumentPosition(order[i])&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
it('keeps the recording status reachable in the header and opens the existing health details', ()=>{
 setup([],{recordingHealth:{status:'limited',issues:[],permission:'whenInUse'}});
 const pill=within(document.querySelector('.topbar')).getByRole('button',{name:/Recording status/});
 expect(pill.className).toMatch(/is-compact/);
 fireEvent.click(pill);
 expect(screen.getByRole('dialog',{name:'Recording health'})).toBeTruthy();
});
it('shows the totals and connects the first and last activities of the selected day', ()=>{
 setup([trip('late','Evening ride',at(0,18,30),{activity:'Cycling',distanceMeters:12000}),trip('mid','Lunchtime walk',at(0,12,0)),trip('early','Early walk',at(0,6,0))]);
 const summary=within(card()).getByRole('button',{name:'View activities for Today'});
 expect(summary).toHaveTextContent('20');
 expect(within(summary).getByText('3')).toBeTruthy();
 expect(summary).toHaveTextContent('activities');
 const timeline=within(card()).getByRole('list',{name:'Activity timeline'});
 const [first,last]=within(timeline).getAllByRole('button');
 expect(first).toHaveTextContent(/First activity.*Early walk/);
 expect(last).toHaveTextContent(/Last activity.*Evening ride.*Cycling/);
 expect(within(timeline).getByText('12h 30m between starts')).toBeTruthy();
 expect(within(timeline).getByText('1 activity between')).toBeTruthy();
 expect(timeline.querySelector('.home-day-span-scale span')).toHaveStyle({left:'48%'});
 expect(within(card()).queryByText('Lunchtime walk')).toBeNull();
});
it('the activity timeline follows the selected day, and an empty day says so instead of showing another day\'s activity', ()=>{
 setup([trip('t','Today walk',at(0,9)),trip('y','Yesterday run',at(1,7),{activity:'Running'})]);
 expect(within(within(card()).getByRole('list',{name:'Activity timeline'})).getAllByRole('button')).toHaveLength(1);
 expect(within(card()).getByRole('button',{name:/Today walk/})).toBeTruthy();
 fireEvent.click(within(card()).getByRole('button',{name:'Previous day'}));
 expect(within(card()).getByRole('button',{name:/Yesterday run/})).toBeTruthy();
 expect(within(card()).queryByText('Today walk')).toBeNull();
 fireEvent.click(within(card()).getByRole('button',{name:'Previous day'}));
 expect(within(card()).queryByRole('button',{name:/walk|run/i})).toBeNull();
 expect(within(card()).getByText('No activities on this day.')).toBeTruthy();
 fireEvent.click(within(card()).getByRole('button',{name:'Today'}));
 expect(within(card()).getByRole('button',{name:/Today walk/})).toBeTruthy();
});
it('says so when nothing has been recorded yet today', ()=>{
 setup([trip('y','Yesterday run',at(1,7))]);
 expect(within(card()).getByText('No activities yet today.')).toBeTruthy();
 expect(within(card()).queryByText('Yesterday run')).toBeNull();
});
it('the activity row opens that activity, and the summary opens the day: separate buttons that never trigger each other', ()=>{
 setup([trip('a','Morning walk',at(0,8,15))]);
 fireEvent.click(within(card()).getByRole('button',{name:/Morning walk/}));
 expect(screen.queryByRole('region',{name:'Daily activity summary'})).toBeNull(); // left Home
 expect(screen.queryByRole('button',{name:'Open Morning walk'})).toBeNull();     // and on the activity's own screen, not on the Activities list
 cleanup();
 setup([trip('a','Morning walk',at(0,8,15))]);
 fireEvent.click(within(card()).getByRole('button',{name:'View activities for Today'}));
 expect(screen.getByRole('button',{name:'Open Morning walk'})).toBeTruthy(); // the Activities list, not the details
});
it('returns from an activity to the same day on Home',()=>{
 setup([trip('t','Today walk',at(0,9)),trip('y','Yesterday run',at(1,7))]);
 fireEvent.click(within(card()).getByRole('button',{name:'Previous day'}));
 fireEvent.click(within(card()).getByRole('button',{name:/Yesterday run/}));
 fireEvent.click(screen.getByRole('button',{name:'Back to Home'}));
 expect(within(card()).getByText('Yesterday')).toBeInTheDocument();
 expect(within(card()).getByRole('button',{name:/Yesterday run/})).toBeInTheDocument();
 expect(within(card()).queryByText('Today walk')).toBeNull();
});

it('a swipe changes the day and does not also open anything', ()=>{
 setup([trip('t','Today walk',at(0,9)),trip('y','Yesterday run',at(1,7))]);
 const section=card();
 const summary=within(section).getByRole('button',{name:'View activities for Today'});
 fireEvent.touchStart(summary,{touches:[{clientX:300,clientY:100}]});
 fireEvent.touchEnd(summary,{changedTouches:[{clientX:100,clientY:104}]});
 fireEvent.click(summary); // the click that follows a swipe
 expect(within(card()).getByRole('button',{name:/Yesterday run/})).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Open Yesterday run'})).toBeNull();
});
it('copes with a long title and long names without hiding anything', ()=>{
 const long='A very long activity title that goes on and on across the whole card '.repeat(3).trim();
 friends.people=[{user_id:'ann',display_name:'Annabelle-Wilhelmina Featherstonehaugh',latitude:-34.5,longitude:150.9,updated_at:new Date().toISOString(),accuracy:10}];
 setup([trip('a',long,at(0,8))]);
 expect(within(card()).getByRole('button',{name:new RegExp(long.slice(0,30))})).toBeTruthy();
 expect(screen.getByRole('button',{name:'Wave to Annabelle-Wilhelmina Featherstonehaugh'})).toBeTruthy();
});
it('Friends: tapping a person opens the Map on them and Poke only pokes', ()=>{
 friends.people=[{user_id:'ann',display_name:'Ann',latitude:-34.5,longitude:150.9,updated_at:new Date().toISOString(),accuracy:10}];
 setup([]);
 expect(screen.getByRole('button',{name:'Wave to Ann'})).toBeTruthy();
 fireEvent.click(screen.getByLabelText(/Show Ann on the Map/));
 expect(screen.getByRole('button',{name:/^Showing Ann/})).toBeTruthy();
});
it('handles no friends: the existing empty state, no Poke buttons', ()=>{
 setup([]);
 expect(screen.getByText('No recent shared statuses')).toBeTruthy();
 expect(screen.queryByRole('button',{name:/^Wave to/})).toBeNull();
});
it('an activity that ends on another day shows only when it began', ()=>{
 const start=at(1,23,30);
 setup([trip('n','Night drive',start,{endedAt:start+3*3600})]);
 fireEvent.click(within(card()).getByRole('button',{name:'Previous day'}));
 const row=within(card()).getByRole('button',{name:/Night drive/});
 expect(row.textContent).toMatch(/11:30 pm · /);
 expect(row.textContent).not.toMatch(/–/);
});
it('a swipe that starts on an arrow or the Today button moves one day only, not two', ()=>{
 setup([trip('t','Today walk',at(0,9)),trip('y','Yesterday run',at(1,7)),trip('d','Older ride',at(2,7))]);
 const previous=within(card()).getByRole('button',{name:'Previous day'});
 fireEvent.touchStart(previous,{touches:[{clientX:300,clientY:100}]});
 fireEvent.touchEnd(previous,{changedTouches:[{clientX:100,clientY:102}]});
 fireEvent.click(previous); // the click that ends the swipe
 expect(within(card()).getByRole('button',{name:/Yesterday run/})).toBeTruthy();
});
it('names an untitled activity by its type, and marks the Home page for its compact header', ()=>{
 setup([trip('a','',at(0,9))]);
 expect(within(card()).getByRole('button',{name:/Walking/})).toBeTruthy();
 expect(document.querySelector('main .home-day')).toBeTruthy();
});
it('names the weekday for days other than Today and Yesterday, with the date', ()=>{
 setup([trip('d','Older ride',at(3,7))]);
 expect(within(card()).getByRole('heading').textContent).toBe('Today · '+new Date().toLocaleDateString('en-AU',{day:'numeric',month:'long'}));
 fireEvent.click(within(card()).getByRole('button',{name:'Previous day'}));
 expect(within(card()).getByRole('heading').textContent).toMatch(/^Yesterday · /);
 fireEvent.click(within(card()).getByRole('button',{name:'Previous day'}));
 const day=new Date();day.setDate(day.getDate()-2);
 const title=within(card()).getByRole('heading').textContent;
 expect(title).toBe(day.toLocaleDateString('en-AU',{weekday:'long'})+' · '+day.toLocaleDateString('en-AU',{day:'numeric',month:'long'}));
});

