import {readFileSync} from 'node:fs';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('../components/ActivityPrivacy.jsx',()=>({default:()=>null}));
vi.mock('../components/JourneyMap.jsx',()=>({default:()=><div>map</div>}));
import {heartRateOf,heartRateRuns,routeAt,saveMaximum,savedMaximum,timeInZones} from './heartRate.js';
import HeartRatePanel from '../components/HeartRatePanel.jsx';
import ActivityDetail from '../components/ActivityDetail.jsx';
import {recordedJourney} from './recorder.js';
import {publicationPreview} from './activityPrivacy.js';
import {sharedLocationPayload} from './householdRealtime.js';
afterEach(cleanup);
beforeEach(()=>localStorage.clear());
const s=(timestamp,bpm)=>({timestamp,bpm});
const samples=[s(1005,100),s(1010,120),s(1015,150),s(1100,160),s(1105,170)];
const heartRate={samples,pausePeriods:[{start:1020,end:1090}],summary:{average:140,maximum:170,minimum:100,samples:5,gaps:0}};
const trip={id:'t',activity:'Running',source:'watch',recordingMode:'watch',state:'finished',title:'Run',startedAt:1000,endedAt:1200,distanceMeters:0,accumulatedSeconds:130,points:[],details:{heartRate}};

it('never joins readings across a pause or a sensor gap',()=>{
 expect(heartRateRuns(samples,heartRate.pausePeriods).map(run=>run.length)).toEqual([3,2]);
 expect(heartRateRuns([s(1,90),s(5,91),s(100,95)]).map(run=>run.length)).toEqual([2,1]);
});
it('credits zones only for observed time, from the maximum the person gave',()=>{
 const result=timeInZones(samples,heartRate.pausePeriods,200);
 expect(result.zones.map(z=>z.seconds)).toEqual([5,5,0,5,0]);
 expect(result.totalSeconds).toBe(15);
 expect(timeInZones(samples,[],null)).toBeNull();
 expect(result.zones[0]).toMatchObject({fromBpm:100,toBpm:120});
 expect(result.zones[4].toBpm).toBeNull();
});
it('reads distance and speed at a moment, and nothing across a gap',()=>{
 const points=[{latitude:0,longitude:0,timestamp:1000,segment:0,speed:2},{latitude:0.001,longitude:0,timestamp:1010,segment:0,speed:3}];
 expect(routeAt(points,1012).distanceMeters).toBeGreaterThan(100);
 expect(routeAt(points,1012).speed).toBe(3);
 expect(routeAt(points,1100)).toBeNull();
 expect(routeAt([],1000)).toBeNull();
});
it('keeps a personal maximum per account and refuses nonsense',()=>{
 expect(saveMaximum('a',188)).toBe(188);
 expect(savedMaximum('a')).toBe(188);
 expect(savedMaximum('b')).toBeNull();
 expect(saveMaximum('a',20)).toBeNull();
 expect(savedMaximum('a')).toBeNull();
});
it('shows the summary and asks for a maximum instead of assuming one',()=>{
 render(<HeartRatePanel trip={trip} owner="a"/>);
 expect(screen.getByText('140 BPM')).toBeInTheDocument();
 expect(screen.getByText('170 BPM')).toBeInTheDocument();
 expect(screen.getByRole('img',{name:/Heart rate over time/})).toBeInTheDocument();
 expect(screen.getByText('Shaded: paused, not recorded.')).toBeInTheDocument();
 expect(screen.queryByText('Zone 5')).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Maximum heart rate in BPM'),{target:{value:'190'}});
 fireEvent.click(screen.getByRole('button',{name:'Show zones'}));
 expect(screen.getByText('Zone 5')).toBeInTheDocument();
 expect(screen.getByText(/10% bands of the maximum you entered \(190 BPM\)/)).toBeInTheDocument();
});
it('renders nothing rather than a zero when an activity has no readings',()=>{
 const {container}=render(<HeartRatePanel trip={{...trip,details:{}}}/>);
 expect(container).toBeEmptyDOMElement();
 expect(heartRateOf({details:{heartRate:{samples:[],summary:null}}})).toBeNull();
});
it('opens an indoor Watch workout with no route',()=>{
 const indoor=recordedJourney({...trip,details:{indoor:true,heartRate}});
 render(<ActivityDetail trip={indoor} places={[]}/>);
 expect(screen.getByText('Indoor activity · no route was recorded.')).toBeInTheDocument();
 expect(screen.getByRole('region',{name:'Heart rate'})).toBeInTheDocument();
});
it('names an overlapping recording and keeps both',()=>{
 render(<ActivityDetail trip={recordedJourney({...trip,details:{overlaps:[{activityID:'p',title:'Phone run',kind:'manual',seconds:600}]}})} places={[]}/>);
 expect(screen.getByRole('status')).toHaveTextContent('Phone run · 10 min together. Both are kept');
});
it('shows nothing of held readings until the person answers',()=>{
 const onResolve=vi.fn();
 render(<HeartRatePanel trip={{...trip,details:{unverifiedHeartRate:heartRate}}} onResolve={onResolve}/>);
 expect(screen.queryByText('140 BPM')).not.toBeInTheDocument();
 expect(screen.queryByRole('img',{name:/Heart rate/})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'This was me'}));
 expect(onResolve).toHaveBeenCalledWith(true);
 fireEvent.click(screen.getByRole('button',{name:'Remove it'}));
 expect(onResolve).toHaveBeenLastCalledWith(false);
});
it('keeps heart rate out of everything that leaves the phone',()=>{
 expect(JSON.stringify(publicationPreview(trip,[]))).not.toMatch(/heartRate|bpm/i);
 expect(JSON.stringify(sharedLocationPayload({latitude:1,longitude:2,accuracy:3,speed:4,timestamp:5,heartRate:120}))).not.toMatch(/heart/i);
});
it('never lets out-of-order or impossible readings produce negative time',()=>{
 const shuffled=[s(1020,170),s(1000,120),s(1010,150),s(1010,151),s(NaN,120),s(1030,900),s(-5,100)];
 const result=timeInZones(shuffled,[],200);
 expect(result.zones.every(z=>z.seconds>=0)).toBe(true);
 expect(result.totalSeconds).toBe(20);
 expect(result.zones.map(z=>z.seconds)).toEqual([0,10,10,0,0]);
 expect(heartRateRuns(shuffled)).toEqual([[s(1000,120),s(1010,150),s(1020,170)]]);
 const record=heartRateOf({details:{heartRate:{samples:shuffled,pausePeriods:[{start:9,end:3},{start:1,end:2}],summary:heartRate.summary}}});
 expect(record.samples.map(x=>x.timestamp)).toEqual([1000,1010,1020]);
 expect(record.pausePeriods).toEqual([{start:1,end:2}]);
});
it('adds no distance across missing GPS, even inside one segment',()=>{
 const point=(latitude,timestamp)=>({latitude,longitude:0,timestamp,segment:0,speed:2});
 const moving=routeAt([point(0,1000),point(.001,1010)],1010).distanceMeters;
 expect(routeAt([point(0,1000),point(.001,1010),point(.5,1500),point(.501,1510)],1510).distanceMeters).toBeCloseTo(moving*2,0);
});
it('keeps no maximum for an unknown account, so none can pass between accounts',()=>{
 expect(saveMaximum(undefined,188)).toBeNull();
 expect(localStorage.length).toBe(0);
 localStorage.setItem('letm3go.maximumHeartRate.device','188');
 expect(savedMaximum(undefined)).toBeNull();
});
it('gives every activity detail entry point the signed-in account',()=>{
 const uses=['src/App.jsx','src/components/GroupedJourneyDetail.jsx'].flatMap(file=>readFileSync(file,'utf8').match(/<ActivityDetail\b[^>]{0,80}/g));
 expect(uses).toHaveLength(2);
 for(const use of uses)expect(use).toContain('ownerID={');
});
it('shows the zones saved for this account from an activity opened with it',()=>{
 saveMaximum('a',190);
 render(<ActivityDetail ownerID="a" trip={recordedJourney(trip)} places={[]}/>);
 expect(screen.getByText('Zone 5')).toBeInTheDocument();
 cleanup();
 render(<ActivityDetail ownerID="b" trip={recordedJourney(trip)} places={[]}/>);
 expect(screen.queryByText('Zone 5')).not.toBeInTheDocument();
});
