import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import LocationExperiment from './LocationExperiment.jsx';
import TrackingPermissions from './TrackingPermissions.jsx';
afterEach(cleanup);
const experiment=(over={})=>({available:true,unlocked:true,mode:'a',label:'Mode A · current behaviour',blocked:{},sessionOwnership:'startedThisProcess',keepAliveRunning:false,runningAPIs:'standard(standby),activitySession',
 predicted:{pill:'yes',arrow:true,basis:'a background location session is held'},observations:[],confounders:'none',expiresAt:null,...over});

describe('the developer-only location experiment',()=>{
 it('is invisible until it is unlocked',()=>{
  const {container}=render(<LocationExperiment state={{storageReady:true,experiment:experiment({unlocked:false})}} run={vi.fn()} busy={false}/>);
  expect(container).toBeEmptyDOMElement();
  cleanup();
  const none=render(<LocationExperiment state={{storageReady:true}} run={vi.fn()} busy={false}/>);
  expect(none.container).toBeEmptyDOMElement();
 });
 it('is not offered in a build that does not allow it, even if native says it is unlocked',()=>{
  const {container}=render(<LocationExperiment state={{storageReady:true,experiment:experiment({available:false})}} run={vi.fn()} busy={false}/>);
  expect(container).toBeEmptyDOMElement();
 });
 it('selects a mode through the native recorder',()=>{
  const run=vi.fn();
  render(<LocationExperiment state={{storageReady:true,experiment:experiment()}} run={run} busy={false}/>);
  expect(screen.getByRole('radio',{name:'Mode A'})).toHaveAttribute('aria-checked','true');
  fireEvent.click(screen.getByRole('radio',{name:'Mode B'}));
  expect(run).toHaveBeenCalledWith('setLocationExperimentMode','b');
 });
 it('disables a mode and says why while a journey or recovery blocks the change',()=>{
  const run=vi.fn();
  render(<LocationExperiment state={{storageReady:true,experiment:experiment({blocked:{b:'an automatic journey is open',c:'an automatic journey is open'}})}} run={run} busy={false}/>);
  expect(screen.getByRole('radio',{name:'Mode B'})).toBeDisabled();
  expect(screen.getByRole('radio',{name:'Mode C'})).toBeDisabled();
  expect(screen.getAllByText(/Cannot switch now: an automatic journey is open/)).toHaveLength(2);
  fireEvent.click(screen.getByRole('radio',{name:'Mode B'}));
  expect(run).not.toHaveBeenCalled();
 });
 it('records a physical observation apart from the prediction, with its note',async()=>{
  const run=vi.fn().mockResolvedValue(true);
  render(<LocationExperiment state={{storageReady:true,experiment:experiment()}} run={run} busy={false}/>);
  fireEvent.change(screen.getByLabelText('Observation note'),{target:{value:'locked, at home'}});
  fireEvent.click(screen.getByRole('button',{name:'Blue pill visible'}));
  expect(run).toHaveBeenCalledWith('recordIndicatorObservation','pill','locked, at home');
  expect(screen.getByText('Predicted by the app (not an observation)')).toBeInTheDocument();
  expect(screen.getByText('Last physical observation (a person)').nextSibling).toHaveTextContent('None recorded');
 });
 it('can hide itself again',()=>{
  const run=vi.fn();
  render(<LocationExperiment state={{storageReady:true,experiment:experiment({mode:'b'})}} run={run} busy={false}/>);
  fireEvent.click(screen.getByRole('button',{name:/Hide the experiment and return to Mode A/}));
  expect(run).toHaveBeenCalledWith('setLocationExperimentUnlocked',false);
 });
 it('appears on Tracking & Permissions only after seven taps on the title, and never for an ordinary user',()=>{
  const run=vi.fn();
  const base={permission:'always',storageReady:true,trackingServices:{},experiment:experiment({unlocked:false})};
  render(<TrackingPermissions recording={{state:base,run,busy:false,error:''}} onBack={vi.fn()}/>);
  expect(screen.queryByText('Location experiment (developer)')).toBeNull();
  const title=screen.getByRole('heading',{name:'Tracking & Permissions'});
  for(let tap=0;tap<6;tap++)fireEvent.click(title);
  expect(run).not.toHaveBeenCalled();
  fireEvent.click(title);
  expect(run).toHaveBeenCalledWith('setLocationExperimentUnlocked',true);
 });
 it('ignores seven taps in a build that does not allow the experiment',()=>{
  const run=vi.fn();
  render(<TrackingPermissions recording={{state:{permission:'always',storageReady:true,trackingServices:{},experiment:experiment({unlocked:false,available:false})},run,busy:false,error:''}} onBack={vi.fn()}/>);
  const title=screen.getByRole('heading',{name:'Tracking & Permissions'});
  for(let tap=0;tap<9;tap++)fireEvent.click(title);
  expect(run).not.toHaveBeenCalled();
 });
 it('shows the experiment on Tracking & Permissions once native reports it unlocked',()=>{
  render(<TrackingPermissions recording={{state:{permission:'always',storageReady:true,trackingServices:{},experiment:experiment()},run:vi.fn(),busy:false,error:''}} onBack={vi.fn()}/>);
  expect(screen.getByText('Location experiment (developer)')).toBeInTheDocument();
});
});
