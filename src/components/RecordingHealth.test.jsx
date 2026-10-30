import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {useState} from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {RecordingHealthChip,RecordingHealthDetail,RecordingWarning} from './RecordingHealth.jsx';
import {useRecordingWarning} from '../lib/useRecordingWarning.js';
const mocks=vi.hoisted(()=>({noteRecordingWarning:vi.fn()}));
vi.mock('../lib/recorder.js',()=>({recorder:mocks}));
afterEach(()=>{cleanup();mocks.noteRecordingWarning.mockClear();Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});});
const base={status:'ready',permissions:'ready',issues:[],services:'registered',automaticEnabled:true,locationServices:true,location:'always',precise:true,motion:'authorized',backgroundRefresh:'available'};
const limited={...base,status:'limited',permissions:'limited',issues:['locationWhileUsing'],location:'whenInUse',services:'notRequested'};
function Home({health,run=vi.fn(),onOpen=vi.fn(),recording=false}){
 const warning=useRecordingWarning(),[tab,setTab]=useState('Home');
 return <><button onClick={()=>setTab(tab==='Home'?'Map':'Home')}>switch</button><RecordingWarning health={health} run={run} warning={warning} tab={tab} recording={recording}/>{tab==='Home'&&<RecordingHealthChip health={health} onOpen={onOpen}/>}</>;
}
const leave=()=>act(()=>{Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
const back=()=>act(()=>{Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});document.dispatchEvent(new Event('visibilitychange'));});

it('shows nothing when the native build reports no health',()=>{render(<Home/>);expect(screen.queryByRole('region')).toBeNull();});
it('shows Ready with no warning when every prerequisite is met',()=>{
 render(<Home health={base}/>);
 expect(screen.getByRole('button',{name:/Recording status: Ready/})).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Not Now'})).toBeNull();
});
it('warns with the exact wording and opens iOS Settings without claiming anything changed',()=>{
 const run=vi.fn();render(<Home health={limited} run={run}/>);
 const warning=screen.getByRole('status');
 expect(within(warning).getByText('Automatic Recording Is Limited')).toBeInTheDocument();
 expect(warning).toHaveTextContent('Letm3go needs Always Allow Location access to automatically detect and record your journeys when the app is in the background.');
 expect(warning).toHaveTextContent('Your current setting is While Using the App, so drives, walks and other activities may not be recorded unless the app is open.');
 fireEvent.click(screen.getByRole('button',{name:'Open Settings'}));
 expect(run).toHaveBeenCalledWith('openSettings');
 expect(warning).toHaveTextContent('While Using the App');
});
it('Not Now hides the warning for this session but never the status, including across tabs',()=>{
 render(<Home health={limited}/>);
 fireEvent.click(screen.getByRole('button',{name:'Not Now'}));
 expect(screen.queryByRole('status')).toBeNull();
 expect(screen.getByRole('button',{name:/Recording status: Limited/})).toBeInTheDocument();
 fireEvent.click(screen.getByText('switch'));fireEvent.click(screen.getByText('switch'));
 expect(screen.queryByRole('status')).toBeNull();
});
it('warns again on the next opening while the problem remains',()=>{
 render(<Home health={limited}/>);
 fireEvent.click(screen.getByRole('button',{name:'Not Now'}));
 leave();back();
 expect(screen.getByRole('status')).toHaveTextContent('Automatic Recording Is Limited');
 expect(screen.getAllByRole('status')).toHaveLength(1);
});
it('a worse problem is not hidden by dismissing a lesser one, and only one warning shows',()=>{
 const {rerender}=render(<Home health={limited}/>);
 fireEvent.click(screen.getByRole('button',{name:'Not Now'}));
 rerender(<Home health={{...base,status:'unavailable',issues:['locationDenied','motionDenied'],location:'denied',services:'notRequested'}}/>);
 expect(screen.getAllByRole('status')).toHaveLength(1);
 expect(screen.getByRole('status')).toHaveTextContent('Automatic Recording Is Unavailable');
 expect(screen.getByRole('button',{name:/Recording status: Unavailable/})).toBeInTheDocument();
});
it('removes the warning by itself once permission is restored',()=>{
 const {rerender}=render(<Home health={limited}/>);
 rerender(<Home health={base}/>);
 expect(screen.queryByRole('status')).toBeNull();
 expect(screen.getByRole('button',{name:/Recording status: Ready/})).toBeInTheDocument();
});
it('opens the detail view from the status',()=>{
 const onOpen=vi.fn();render(<Home health={limited} onOpen={onOpen}/>);
 fireEvent.click(screen.getByRole('button',{name:/Recording status/}));expect(onOpen).toHaveBeenCalled();
});
it('lists each permission and offers each fix, keeping settings apart from running services',()=>{
 const run=vi.fn();
 render(<RecordingHealthDetail health={{...limited,issues:['locationWhileUsing','backgroundRefreshOff'],backgroundRefresh:'denied'}} run={run}/>);
 expect(screen.getByText('Location access').nextSibling).toHaveTextContent('While Using the App');
 expect(screen.getByText('Background App Refresh').nextSibling).toHaveTextContent('Off');
 expect(screen.getByText('Recording services').nextSibling).toHaveTextContent('Not requested');
 expect(screen.getByText(/does not mean a journey is being recorded/)).toBeInTheDocument();
 expect(screen.getByText(/Some iOS location features can still work/)).toBeInTheDocument();
 expect(screen.getAllByRole('button',{name:'Open Settings'})).toHaveLength(2);
});
it('turns Automatic Tracking on in the app instead of sending people to Settings',()=>{
 const run=vi.fn();render(<Home health={{...base,status:'unavailable',issues:['automaticOff'],automaticEnabled:false}} run={run}/>);
 fireEvent.click(screen.getByRole('button',{name:'Turn On'}));expect(run).toHaveBeenCalledWith('setAutomatic',true);
});
it('never says Ready when the settings are fine but recording services are not running',()=>{
 const stopped={...base,status:'limited',permissions:'ready',issues:['servicesNotRunning'],services:'notRequested'};
 render(<Home health={stopped}/>);
 expect(screen.getByRole('button',{name:/Recording status: Limited/})).toBeInTheDocument();
 expect(screen.getByRole('status')).toHaveTextContent('Your settings allow automatic recording, but its location services have not been started.');
 expect(screen.queryByRole('button',{name:'Open Settings'})).toBeNull();
 cleanup();
 render(<RecordingHealthDetail health={stopped} run={vi.fn()}/>);
 expect(screen.getByText('Permissions').nextSibling).toHaveTextContent('Ready');
 expect(screen.getByText('Recording services').nextSibling).toHaveTextContent('Not requested');
});
it('updates at once when health changes while the app stays open, without being reopened',()=>{
 const {rerender}=render(<Home health={base}/>);
 rerender(<Home health={limited}/>);
 expect(screen.getByRole('status')).toHaveTextContent('Automatic Recording Is Limited');
 expect(screen.getByRole('button',{name:/Recording status: Limited/})).toBeInTheDocument();
});
it('dismissing a warning cannot suppress a newly detected, more serious problem',()=>{
 const denied={...base,status:'unavailable',permissions:'unavailable',issues:['locationDenied','locationWhileUsing'],location:'denied'};
 const {rerender}=render(<Home health={limited}/>);
 fireEvent.click(screen.getByRole('button',{name:'Not Now'}));
 rerender(<Home health={denied}/>);
 expect(screen.getByRole('status')).toHaveTextContent('Letm3go does not have Location access');
});
it('logs each warning action once per session for the diagnostic file',()=>{
 const {rerender}=render(<Home health={limited}/>);
 rerender(<Home health={{...limited}}/>);rerender(<Home health={{...limited}}/>);
 expect(mocks.noteRecordingWarning.mock.calls).toEqual([['shown','locationWhileUsing']]);
 fireEvent.click(screen.getByRole('button',{name:'Open Settings'}));
 fireEvent.click(screen.getByRole('button',{name:'Not Now'}));
 expect(mocks.noteRecordingWarning.mock.calls.slice(1)).toEqual([['openSettings','locationWhileUsing'],['dismissed','locationWhileUsing']]);
 leave();back();
 expect(mocks.noteRecordingWarning).toHaveBeenLastCalledWith('shown','locationWhileUsing');
 expect(mocks.noteRecordingWarning).toHaveBeenCalledTimes(4);
});
it('shows a serious problem on whichever tab is open, once, with shared dismissal',()=>{
 render(<Home health={limited}/>);
 fireEvent.click(screen.getByText('switch'));
 expect(screen.getAllByRole('status')).toHaveLength(1);
 expect(screen.getByRole('status')).toHaveTextContent('Automatic Recording Is Limited');
 fireEvent.click(screen.getByRole('button',{name:'Not Now'}));
 fireEvent.click(screen.getByText('switch'));
 expect(screen.queryByRole('status')).toBeNull();
 expect(mocks.noteRecordingWarning.mock.calls.filter(([action])=>action==='shown')).toHaveLength(1);
});
it('keeps lesser problems on Home instead of following people around',()=>{
 render(<Home health={{...base,status:'limited',permissions:'limited',issues:['preciseOff'],precise:false}}/>);
 expect(screen.getByRole('status')).toHaveTextContent('Less Accurate');
 fireEvent.click(screen.getByText('switch'));
 expect(screen.queryByRole('status')).toBeNull();
});
it('never puts a warning over a manual recording, and the status stays',()=>{
 render(<Home health={limited} recording/>);
 expect(screen.queryByRole('status')).toBeNull();
 expect(screen.getByRole('button',{name:/Recording status: Limited/})).toBeInTheDocument();
 expect(mocks.noteRecordingWarning).not.toHaveBeenCalled();
});
it('says Checking, with no warning, until iOS has answered',()=>{
 render(<Home health={{...base,status:'checking',permissions:'checking'}}/>);
 expect(screen.getByRole('button',{name:/Recording status: Checking/})).toBeInTheDocument();
 expect(screen.queryByRole('status')).toBeNull();
});
it('asks for Motion & Fitness in the app when iOS has not asked yet, not when the device has none',()=>{
 const run=vi.fn();
 const {rerender}=render(<Home run={run} health={{...base,status:'limited',permissions:'limited',issues:['motionNotRequested'],motion:'notDetermined'}}/>);
 expect(screen.getByRole('status')).toHaveTextContent('has not asked for Motion & Fitness yet');
 fireEvent.click(screen.getByRole('button',{name:'Allow Motion & Fitness'}));
 expect(run).toHaveBeenCalledWith('requestMotionPermission');
 expect(mocks.noteRecordingWarning).not.toHaveBeenCalledWith('openSettings','motionNotRequested');
 rerender(<Home run={run} health={{...base,status:'limited',permissions:'limited',issues:['motionUnavailable'],motion:'unavailable'}}/>);
 expect(screen.getByRole('status')).toHaveTextContent('not available on this device');
 expect(screen.queryByRole('button',{name:'Open Settings'})).toBeNull();
});
it('reports what iOS has shown about wake-ups, never that they are guaranteed',()=>{
 const {rerender}=render(<RecordingHealthDetail health={base} run={vi.fn()}/>);
 expect(screen.getByText('Recording services').nextSibling).toHaveTextContent('Requested · iOS holds a place wake-up');
 expect(screen.getByText(/iOS decides when wake-ups arrive/)).toBeInTheDocument();
 expect(screen.queryByText('Running')).toBeNull();
 rerender(<RecordingHealthDetail health={{...base,services:'requested'}} run={vi.fn()}/>);
 expect(screen.getByText('Recording services').nextSibling).toHaveTextContent('Requested from iOS');
 rerender(<RecordingHealthDetail health={{...base,status:'limited',issues:['monitoringFailed'],services:'failed'}} run={vi.fn()}/>);
 expect(screen.getByText('Recording services').nextSibling).toHaveTextContent('iOS reported a problem');
 expect(screen.getByText(/iOS reported a problem with location monitoring/)).toBeInTheDocument();
});
