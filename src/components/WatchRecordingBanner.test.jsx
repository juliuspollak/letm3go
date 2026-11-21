import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import WatchRecordingBanner from './WatchRecordingBanner.jsx';
import {recordControlState} from '../lib/recordingState.js';
afterEach(cleanup);
const watch=(over={})=>({label:'Apple Watch',activity:'Gym',state:'recording',startedAt:1000,sessionID:'s',...over});
describe('a recording running on the Watch',()=>{
 it('is shown with the activity and how long it has run, and opens the Record screen',()=>{
  const open=vi.fn();render(<WatchRecordingBanner elsewhere={watch()} nowMs={(1000+25*60)*1000} onOpen={open}/>);
  expect(screen.getByRole('status')).toHaveTextContent(/Apple Watch is recording/);
  expect(screen.getByRole('status')).toHaveTextContent(/25m|25 min/);
  fireEvent.click(screen.getByRole('button',{name:'Open'}));expect(open).toHaveBeenCalled();
 });
 it('names only the device when the native label is a whole phrase',()=>{
  render(<WatchRecordingBanner elsewhere={watch({label:'Recording on Apple Watch'})} nowMs={2000*1000} onOpen={()=>{}}/>);
  expect(screen.getByRole('status')).toHaveTextContent(/^Apple Watch is recording General workout/);
 });
 it('says "paused" for a paused recording',()=>{
  render(<WatchRecordingBanner elsewhere={watch({state:'paused'})} nowMs={2000*1000} onOpen={()=>{}}/>);
  expect(screen.getByRole('status')).toHaveTextContent(/has paused/);
 });
 it('asks whether it was forgotten once it has run for hours',()=>{
  render(<WatchRecordingBanner elsewhere={watch()} nowMs={(1000+3*3600)*1000} onOpen={()=>{}}/>);
  expect(screen.getByText(/Still going\?/)).toBeInTheDocument();
 });
 it('shows nothing when no other device is recording',()=>{
  const {container}=render(<WatchRecordingBanner elsewhere={null} nowMs={0} onOpen={()=>{}}/>);
  expect(container).toBeEmptyDOMElement();
 });
 it('marks the Record button, but never over this phone\'s own recording',()=>{
  expect(recordControlState({recordingElsewhere:watch()})).toBe('elsewhere');
  expect(recordControlState({recordingElsewhere:watch(),active:{state:'recording'}})).toBe('recording');
  expect(recordControlState({})).toBe('idle');
 });
});
