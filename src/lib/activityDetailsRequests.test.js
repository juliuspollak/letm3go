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
 // The native tags section sends one request and shows one answer, so a partial
 // failure reads the same there as in React.
 const tagTrip={id:'a',activity:'Driving',tags:['Bunnings'],segmentIDs:['s1'],points:[{latitude:-34.4,longitude:150.9,timestamp:1790000000,accuracy:5}]};
 it('adds a tag and remembers the destination in one request',async()=>{
  const act=vi.fn().mockResolvedValue(true),run=vi.fn().mockResolvedValue({places:[]});
  const result=await requests.tagAndRemember({trip:tagTrip,run,grouping:{metadata:{manualTags:{s1:[]}},act}},{name:'Fuel',remember:true});
  expect(act).toHaveBeenCalledWith({type:'manualTags',anchor:'s1',tags:['Fuel']});
  expect(run).toHaveBeenCalledWith('savePlace',{name:'Fuel',kind:'favourite',latitude:-34.4,longitude:150.9,radius:200});
  expect(result).toEqual({tag:'added',place:'saved',name:'Fuel',clear:true,notice:'Saved Fuel as a place. Future trips ending within 200 m are named Fuel.'});
 });
 it('remembers the destination without rewriting a tag the activity carries',async()=>{
  const act=vi.fn(),run=vi.fn().mockResolvedValue({places:[]});
  const result=await requests.tagAndRemember({trip:tagTrip,run,grouping:{metadata:{},act}},{name:'bunnings',remember:true});
  expect(act).not.toHaveBeenCalled();
  expect(result).toMatchObject({tag:'applied',place:'saved',clear:true});
 });
 it('reports the half that failed, with the recorder reason, and keeps the typed name',async()=>{
  const act=vi.fn().mockResolvedValue(true),run=vi.fn().mockResolvedValue(null);
  const result=await requests.tagAndRemember({trip:tagTrip,run,grouping:{metadata:{},act},lastError:()=>'The recorder is offline.'},{name:'Fuel',remember:true});
  expect(result).toEqual({tag:'added',place:'failed',name:'Fuel',clear:false,
   notice:'Tag added to this trip only. The recorder is offline. Try again to save the destination.'});
 });
 it('holds the tag back until the trip has room, without saving the place either',async()=>{
  const act=vi.fn(),run=vi.fn();
  const full=Array.from({length:20},(_,i)=>`Tag ${i}`);
  const result=await requests.tagAndRemember({trip:tagTrip,run,grouping:{metadata:{manualTags:{s1:full}},act}},{name:'Fuel',remember:true});
  expect(act).not.toHaveBeenCalled();expect(run).not.toHaveBeenCalled();
  expect(result).toMatchObject({tag:'failed',place:'skipped',clear:false});
 });
 it('updates the selection after a native write and leaves after a delete',async()=>{
  const onUpdated=vi.fn(),onDeleted=vi.fn(),run=vi.fn().mockResolvedValue({trips:[{id:'a',title:'New'}]});
  await acceptNativeMutation({run,onUpdated,onDeleted,activityID:'a',kind:'updated'});
  expect(onUpdated).toHaveBeenCalledWith({id:'a',title:'New'});
  await acceptNativeMutation({run,onUpdated,onDeleted,activityID:'a',kind:'deleted'});
  expect(onDeleted).toHaveBeenCalledTimes(1);
 });
});

it('sends the activity recording report as feedback and returns the number to quote', async () => {
  const { activityDetailsRequests: requests } = await import('./activityDetailsRequests.js');
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const client = {
    rpc: vi.fn().mockResolvedValue({ data: { id: 't1', owner_id: 'o1', number: 5 }, error: null }),
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'x' } }, error: null }) },
    from: vi.fn(() => ({ upsert, select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'r1' }, error: null }) }) }) })),
    storage: { from: vi.fn(() => ({ remove: vi.fn() })) },
  };
  const original = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = class { open() {} setRequestHeader() {} send() { this.status = 200; this.onload(); this.onloadend?.(); } };
  let result;
  try { result = await requests.sendRecordingReport({ client, trip: { id: 'a', title: 'Driving', startedAt: 1793896237 } }, { note: 'Too short', report: 'Letm3go recording report', token: 'tok', reportID: 'r1' }); } finally { globalThis.XMLHttpRequest = original; }
  expect(result).toEqual({ reference: '#5' });
  expect(client.rpc).toHaveBeenCalledWith('submit_feedback', expect.objectContaining({ p_description: 'Too short', p_title: expect.stringMatching(/^Recording report · Driving · /) }));
  expect(upsert.mock.calls[0][0]).toMatchObject({ id: 'r1', kind: 'recording', object_key: 'o1/t1/r1.txt' });
});

describe('the activity Share sheet',()=>{
 const rpcClient=answers=>({rpc:vi.fn(async name=>answers[name]??{data:null,error:{message:'missing'}})});
 const friends={data:[{user_id:'f1',display_name:'Ava'},{user_id:'f2',display_name:'Ben'}],error:null};
 const save=(args)=>requests.privacySave({client:{},trip:{id:'a'},auth:{preferences:{}}},args);
 beforeEach(()=>{mocks.publish.mockResolvedValue({token:'t'});mocks.status.mockResolvedValue({audience:'private'});mocks.state.mockResolvedValue({});});
 it('opens a never-shared activity with nothing selected, listing friends and the household',async()=>{
  const client=rpcClient({my_activity_sharing:{data:{audience:'private',household:false,friends:[]},error:null},my_friends:friends,my_household:{data:[{id:'h',name:'Family'}],error:null}});
  expect(await requests.privacyStatus({client,trip:{id:'a'}})).toEqual({audience:'private',household:false,friends:[],
   options:{friends:[{id:'f1',name:'Ava'},{id:'f2',name:'Ben'}],household:'Family'}});
 });
 it('opens an already shared activity with its recipients, ignoring people who are no longer friends',async()=>{
  const client=rpcClient({my_activity_sharing:{data:{audience:'friends',household:true,friends:['f2','gone']},error:null},my_friends:friends,my_household:{data:[],error:null}});
  expect(await requests.privacyStatus({client,trip:{id:'a'}})).toMatchObject({audience:'friends',household:true,friends:['f2'],options:{household:null}});
 });
 it('falls back to public/private on a database without the sharing migration',async()=>{
  mocks.status.mockResolvedValue({audience:'public'});
  const client=rpcClient({my_friends:friends,my_household:{data:[],error:null}});
  expect(await requests.privacyStatus({client,trip:{id:'a'}})).toMatchObject({audience:'public',friends:[],options:{friends:[]}});
 });
 it.each([
  [{household:false,friends:['f1']},{audience:'friends',mode:'selected',recipients:['f1']}],
  [{household:false,friends:['f1','f2']},{audience:'friends',mode:'selected',recipients:['f1','f2']}],
  [{household:true,friends:[]},{audience:'household',mode:'household',recipients:[]}],
  [{household:true,friends:['f2']},{audience:'friends',mode:'mixed',recipients:['f2']}],
 ])('saves %j as one server publication %j',async(selection,expected)=>{
  const result=await save({choice:'share',...selection});
  expect(mocks.publish.mock.calls[0][0]).toMatchObject(expected);
  expect(result).toMatchObject({audience:expected.audience,household:selection.household,friends:expected.recipients});
 });
 it('a public link is its own publication; stopping sharing revokes everything',async()=>{
  await save({choice:'public'});
  expect(mocks.publish.mock.calls[0][0]).toMatchObject({audience:'public',mode:null,recipients:[]});
  const {makeActivityPrivate}=await import('./activitySharing.js');
  expect(await save({choice:'private'})).toMatchObject({audience:'private',household:false,friends:[]});
  expect(makeActivityPrivate).toHaveBeenCalledWith({},'a');
 });
 it('refuses an empty selection, so the sheet must confirm Stop sharing instead',async()=>{
  await expect(save({choice:'share',household:false,friends:[]})).rejects.toThrow(/at least one recipient/);
  expect(mocks.publish).not.toHaveBeenCalled();
 });
 it('a failed save reports the error and changes nothing',async()=>{
  mocks.publish.mockRejectedValue(new Error('Sharing could not be confirmed.'));
  await expect(save({choice:'share',household:false,friends:['f1']})).rejects.toThrow('Sharing could not be confirmed.');
 });
 it('Add friends creates the same invitation as Social → Friends',async()=>{
  const client=rpcClient({create_friend_invite:{data:'11111111-1111-4111-8111-111111111111',error:null}});
  const {text}=await requests.createFriendInvite({client});
  expect(text).toContain('au.jpollak.journey://invite/friend?code=11111111-1111-4111-8111-111111111111');
  await expect(requests.createFriendInvite({client:rpcClient({})})).rejects.toThrow(/invitation could not be created/);
 });
});
