import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {useState} from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {RecordingHealthDetail,RecordingHealthHome} from './RecordingHealth.jsx';
import {useRecordingWarning} from '../lib/useRecordingWarning.js';
const mocks=vi.hoisted(()=>({noteRecordingWarning:vi.fn()}));
vi.mock('../lib/recorder.js',()=>({recorder:mocks}));
afterEach(()=>{cleanup();mocks.noteRecordingWarning.mockClear();Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});});
const base={status:'ready',permissions:'ready',issues:[],servicesArmed:true,automaticEnabled:true,locationServices:true,location:'always',precise:true,motion:'authorized',backgroundRefresh:'available'};
const limited={...base,status:'limited',permissions:'limited',issues:['locationWhileUsing'],location:'whenInUse',servicesArmed:false};
function Home({health,run=vi.fn(),onOpen=vi.fn()}){
 const warning=useRecordingWarning(),[tab,setTab]=useState('Home');
 return <><button onClick={()=>setTab(tab==='Home'?'Map':'Home')}>switch</button>{tab==='Home'&&<RecordingHealthHome health={health} run={run} warning={warning} onOpen={onOpen}/>}</>;
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
 rerender(<Home health={{...base,status:'unavailable',issues:['locationDenied','motionDenied'],location:'denied',servicesArmed:false}}/>);
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
 expect(screen.getByText('Recording services').nextSibling).toHaveTextContent('Not running');
 expect(screen.getByText(/does not mean a journey is being recorded/)).toBeInTheDocument();
 expect(screen.getByText(/Some iOS location features can still work/)).toBeInTheDocument();
 expect(screen.getAllByRole('button',{name:'Open Settings'})).toHaveLength(2);
});
it('turns Automatic Tracking on in the app instead of sending people to Settings',()=>{
 const run=vi.fn();render(<Home health={{...base,status:'unavailable',issues:['automaticOff'],automaticEnabled:false}} run={run}/>);
 fireEvent.click(screen.getByRole('button',{name:'Turn On'}));expect(run).toHaveBeenCalledWith('setAutomatic',true);
});
it('never says Ready when the settings are fine but recording services are not running',()=>{
 const stopped={...base,status:'limited',permissions:'ready',issues:['servicesNotRunning'],servicesArmed:false};
 render(<Home health={stopped}/>);
 expect(screen.getByRole('button',{name:/Recording status: Limited/})).toBeInTheDocument();
 expect(screen.getByRole('status')).toHaveTextContent('Your settings allow automatic recording, but its location services are not running.');
 expect(screen.queryByRole('button',{name:'Open Settings'})).toBeNull();
 cleanup();
 render(<RecordingHealthDetail health={stopped} run={vi.fn()}/>);
 expect(screen.getByText('Permissions').nextSibling).toHaveTextContent('Ready');
 expect(screen.getByText('Recording services').nextSibling).toHaveTextContent('Not running');
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
