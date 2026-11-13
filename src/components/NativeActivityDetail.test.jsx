import {act,render} from '@testing-library/react';
import {beforeEach,describe,expect,it,vi} from 'vitest';

const mocks=vi.hoisted(()=>({listeners:{},present:vi.fn(),update:vi.fn(),dismiss:vi.fn(),respond:vi.fn(),acceptMutation:vi.fn(),operation:vi.fn()}));
vi.mock('../lib/nativeActivityDetails.js',()=>({
 nativeDetails:{present:mocks.present,update:mocks.update,dismiss:mocks.dismiss,respond:mocks.respond,addListener:(event,callback)=>{mocks.listeners[event]=callback;return Promise.resolve({remove:vi.fn()});}},
}));
vi.mock('../lib/AuthContext.jsx',()=>({useAuth:()=>({preferences:{}})}));
vi.mock('../lib/supabase.js',()=>({supabase:{}}));
vi.mock('../lib/activityPresentation.js',()=>({activityPresentation:trip=>({activityID:trip.id,header:{state:trip.state||'finished'},title:trip.title})}));
vi.mock('../lib/activityDetailsRequests.js',()=>({acceptNativeMutation:mocks.acceptMutation,activityDetailsRequests:{probe:mocks.operation}}));

import NativeActivityDetail from './NativeActivityDetail.jsx';

const settle=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,5));});
const trip={id:'a',title:'Ride'};
const props={ownerID:'o',trip,places:[],run:vi.fn(),onBack:vi.fn(),onUpdated:vi.fn(),onDeleted:vi.fn()};

beforeEach(async()=>{
 for(const mock of [mocks.present,mocks.update,mocks.dismiss,mocks.respond,mocks.acceptMutation,mocks.operation,props.onBack])mock.mockReset();
 mocks.present.mockResolvedValue();mocks.update.mockResolvedValue();mocks.dismiss.mockResolvedValue();mocks.respond.mockResolvedValue();
});
async function open(){const view=render(<NativeActivityDetail {...props}/>);await settle();return view;}
async function close(view){view.unmount();await settle();}

describe('NativeActivityDetail',()=>{
 it('opens once and sends only real changes, newest revision last',async()=>{
  const view=await open();
  expect(mocks.present).toHaveBeenCalledTimes(1);
  view.rerender(<NativeActivityDetail {...props}/>);await settle();
  expect(mocks.update).not.toHaveBeenCalled();
  view.rerender(<NativeActivityDetail {...props} trip={{...trip,title:'Renamed'}}/>);await settle();
  expect(mocks.update).toHaveBeenCalledTimes(1);
  expect(mocks.update.mock.calls[0][0].revision).toBeGreaterThan(mocks.present.mock.calls[0][0].revision);
  await close(view);
 });
 it('keeps the native screen across a hand-over to another activity',async()=>{
  const view=await open();
  view.unmount();
  const next=render(<NativeActivityDetail {...props} trip={{id:'b',title:'Next'}}/>);
  await settle();
  expect(mocks.dismiss).not.toHaveBeenCalled();
  expect(mocks.present).toHaveBeenCalledTimes(1);
  expect(mocks.update.mock.calls.at(-1)[0].activityID).toBe('b');
  await close(next);
 });
 it('closes the native screen on a real exit',async()=>{
  const view=await open();
  await close(view);
  expect(mocks.dismiss).toHaveBeenCalledTimes(1);
 });
 it('returns to the same place when the native screen closes',async()=>{
  const view=await open();
  act(()=>mocks.listeners.closed());
  expect(props.onBack).toHaveBeenCalledTimes(1);
  await close(view);
 });
 it('makes an older PR source available even when navigation history is scoped to today',async()=>{
  const older={id:'older-pr',title:'Earlier ride'};
  const view=render(<NativeActivityDetail {...props} journeys={[trip]} segmentActivities={[trip,older]}/>);await settle();
  mocks.operation.mockResolvedValue({});
  await act(async()=>{await mocks.listeners.request({requestID:'pr',op:'probe',args:{id:older.id}});});
  expect(mocks.operation.mock.calls[0][0].activities).toContain(older);
  await close(view);
 });
 it('answers a request, and reports a failure instead of hanging',async()=>{
  const view=await open();
  mocks.operation.mockResolvedValueOnce({audience:'private'});
  await act(async()=>{await mocks.listeners.request({requestID:'1',op:'probe',args:{}});});
  expect(mocks.respond).toHaveBeenCalledWith({requestID:'1',ok:true,result:{audience:'private'}});
  mocks.operation.mockRejectedValueOnce(new Error('Offline'));
  await act(async()=>{await mocks.listeners.request({requestID:'2',op:'probe',args:{}});});
  expect(mocks.respond).toHaveBeenCalledWith({requestID:'2',ok:false,message:'Offline'});
  await act(async()=>{await mocks.listeners.request({requestID:'3',op:'unknown',args:{}});});
  expect(mocks.respond.mock.calls.at(-1)[0]).toMatchObject({requestID:'3',ok:false});
  await close(view);
 });
 it('aborts a running request when the screen goes',async()=>{
  const view=await open();
  let signal;
  mocks.operation.mockImplementationOnce((context,args,tools)=>{signal=tools.signal;return new Promise(()=>{});});
  void mocks.listeners.request({requestID:'9',op:'probe'});
  await settle();
  view.unmount();
  expect(signal.aborted).toBe(true);
  await settle();
 });
 it('applies a native mutation for this activity only',async()=>{
  const view=await open();
  act(()=>mocks.listeners.mutation({activityID:'other',kind:'updated'}));
  expect(mocks.acceptMutation).not.toHaveBeenCalled();
  act(()=>mocks.listeners.mutation({activityID:'a',kind:'deleted'}));
  expect(mocks.acceptMutation).toHaveBeenCalledWith(expect.objectContaining({activityID:'a',kind:'deleted'}));
  await close(view);
 });
});
describe('a recording in progress',()=>{
 it('reaches native at most once per interval, ending on the newest fix',async()=>{
  const recording={id:'r',title:'Fix 0',state:'recording'};
  const view=render(<NativeActivityDetail {...props} trip={recording}/>);await settle();
  mocks.update.mockClear();
  view.rerender(<NativeActivityDetail {...props} trip={{...recording,title:'Fix 1'}}/>);await settle();
  view.rerender(<NativeActivityDetail {...props} trip={{...recording,title:'Fix 2'}}/>);await settle();
  expect(mocks.update).not.toHaveBeenCalled();
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,2100));});
  expect(mocks.update).toHaveBeenCalledTimes(1);
  expect(mocks.update.mock.calls[0][0].title).toBe('Fix 2');
  await close(view);
 });
 it('applies a finished activity at once',async()=>{
  const recording={id:'r',title:'Ride',state:'recording'};
  const view=render(<NativeActivityDetail {...props} trip={recording}/>);await settle();
  mocks.update.mockClear();
  view.rerender(<NativeActivityDetail {...props} trip={{...recording,state:'finished'}}/>);await settle();
  expect(mocks.update).toHaveBeenCalledTimes(1);
  await close(view);
 });
});
