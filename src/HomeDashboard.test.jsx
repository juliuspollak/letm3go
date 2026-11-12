import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import App from './App.jsx';
import {emptyRecorder} from './lib/recorder.js';
// The compact Home: header (with the recording status), one Today card with the latest activity OF THE DAY SHOWN, Friends.
const {identity,recorderHook,mapLocationHook,friends}=vi.hoisted(()=>({identity:{value:null},recorderHook:vi.fn(),mapLocationHook:vi.fn(),friends:{people:[]}}));
vi.mock('./lib/AuthContext.jsx',()=>({AuthProvider:({children})=>children,useAuth:()=>identity.value}));
vi.mock('./lib/config.js',()=>({config:{configured:false,appleEnabled:false,pushEnabled:false,teslaEnabled:false}}));
vi.mock('./lib/supabase.js',()=>({supabase:null}));
vi.mock('./lib/useCloudJourneyPage.js',()=>({useCloudJourneyPage:()=>({ids:[],loading:false,error:'',more:false,refresh:()=>{}})}));
vi.mock('./lib/useJourneyScope.js',()=>({useJourneyScope:()=>({loading:false,error:''})}));
vi.mock('./lib/useMapLocation.js',()=>({useMapLocation:mapLocationHook}));
vi.mock('./lib/useRecorder.js',()=>({useRecorder:recorderHook}));
vi.mock('./lib/useFriendLocations.js',()=>({useFriendLocations:()=>({people:friends.people,enabled:true,error:'',ready:true,lastSentAt:0,setEnabled:()=>{},refresh:()=>{}})}));
vi.mock('./components/JourneyMap.jsx',()=>({default:()=><div aria-label="Interactive journey route map"/>}));

const at=(daysAgo,hour,minute=0)=>{const d=new Date();d.setDate(d.getDate()-daysAgo);d.setHours(hour,minute,0,0);return d.getTime()/1000;};
const trip=(id,title,started,over={})=>({id,title,source:'device',activity:'Walking',startedAt:started,endedAt:started+1080,durationSeconds:1080,distanceMeters:4000,points:[],details:{},...over});
const setup=(trips,over={})=>{
 identity.value={status:'authenticated',session:{user:{id:'owner',email:'o@example.com'}},preferences:{displayName:'Me',vehicles:[],onboardingComplete:true},savePreferences:vi.fn(),beginSignIn:vi.fn(),signOut:vi.fn(),retry:vi.fn()};
 recorderHook.mockReturnValue({state:{...emptyRecorder,trips,...over},run:vi.fn(),busy:false,error:''});
 return render(<App/>);
};
beforeEach(()=>{mapLocationHook.mockReturnValue({position:null,loading:false,error:'',locate:vi.fn()});friends.people=[];});
afterEach(()=>{cleanup();localStorage.clear();});
const card=()=>screen.getByRole('region',{name:'Daily activity summary'});

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
it('shows the totals compactly and the latest activity of the day shown', ()=>{
 setup([trip('early','Early walk',at(0,6,0)),trip('late','Evening ride',at(0,18,30),{activity:'Cycling',distanceMeters:12000})]);
 const summary=within(card()).getByRole('button',{name:'View activities for Today'});
 expect(summary).toHaveTextContent('16');
 expect(within(summary).getByText('2')).toBeTruthy();
 expect(summary).toHaveTextContent('activities');
 const latest=within(card()).getByRole('button',{name:/Evening ride/});
 expect(latest).toHaveTextContent('Cycling');
 expect(within(card()).queryByText('Early walk')).toBeNull();
});
it('the latest-activity row follows the selected day, and an empty day says so instead of showing another day\'s activity', ()=>{
 setup([trip('t','Today walk',at(0,9)),trip('y','Yesterday run',at(1,7),{activity:'Running'})]);
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
 expect(screen.getByRole('button',{name:'Poke Annabelle-Wilhelmina Featherstonehaugh'})).toBeTruthy();
});
it('Friends: tapping a person opens the Map on them and Poke only pokes', ()=>{
 friends.people=[{user_id:'ann',display_name:'Ann',latitude:-34.5,longitude:150.9,updated_at:new Date().toISOString(),accuracy:10}];
 setup([]);
 expect(screen.getByRole('button',{name:'Poke Ann'})).toBeTruthy();
 fireEvent.click(screen.getByLabelText(/Show Ann on the Map/));
 expect(screen.getByRole('button',{name:/^Showing Ann/})).toBeTruthy();
});
it('handles no friends: the existing empty state, no Poke buttons', ()=>{
 setup([]);
 expect(screen.getByText('No recent shared statuses')).toBeTruthy();
 expect(screen.queryByRole('button',{name:/^Poke/})).toBeNull();
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

