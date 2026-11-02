import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({publish:vi.fn(),status:vi.fn(),state:vi.fn(),act:vi.fn()}));
vi.mock('./activitySharing.js',()=>({publishActivity:mocks.publish,sharingRequest:mocks.status,makeActivityPrivate:vi.fn()}));
vi.mock('./recorder.js',()=>({recorder:{getState:mocks.state},recordedJourney:trip=>trip}));
vi.mock('./routePlaceScan.js',()=>({scanRoutePlaces:vi.fn()}));
vi.mock('./mtbApi.js',()=>({fetchTrails:vi.fn()}));
import {acceptNativeMutation,activityDetailsRequests as requests} from './activityDetailsRequests.js';

beforeEach(()=>{for(const mock of Object.values(mocks))mock.mockReset();});
describe('native requests',()=>{
 it('passes the cancel signal to publishing',async()=>{
  const {signal}=new AbortController();
  mocks.publish.mockResolvedValue({});
  await requests.privacySave({client:{},trip:{id:'a'},auth:{preferences:{}}},{choice:'public'},{signal});
  expect(mocks.publish.mock.calls[0][0].signal).toBe(signal);
 });
 it('reports a refused grouping change',async()=>{
  await expect(requests.groupingAct({grouping:{act:async()=>false,error:'Nope'}},{action:{}})).rejects.toThrow('Nope');
  await expect(requests.groupingAct({grouping:null},{action:{}})).rejects.toThrow('unavailable');
 });
 it('refuses to open an unknown activity',async()=>{
  await expect(requests.openActivity({activities:[],trip:{},onSource:()=>{}},{id:'x'})).rejects.toThrow('not available');
 });
 it('updates the selection after a native write and leaves after a delete',async()=>{
  const onUpdated=vi.fn(),onDeleted=vi.fn(),run=vi.fn().mockResolvedValue({trips:[{id:'a',title:'New'}]});
  await acceptNativeMutation({run,onUpdated,onDeleted,activityID:'a',kind:'updated'});
  expect(onUpdated).toHaveBeenCalledWith({id:'a',title:'New'});
  await acceptNativeMutation({run,onUpdated,onDeleted,activityID:'a',kind:'deleted'});
  expect(onDeleted).toHaveBeenCalledTimes(1);
 });
});
