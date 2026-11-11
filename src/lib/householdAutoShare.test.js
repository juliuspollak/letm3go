import {beforeEach,describe,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({publish:vi.fn()}));
vi.mock('./activitySharing.js',()=>({publishActivity:mock.publish}));
vi.mock('./hideLiveActivity.js',()=>({flushPendingHides:vi.fn(async()=>{}),isLiveHidden:id=>id==='HIDDEN'}));
import {shareNewHouseholdActivities} from './householdAutoShare.js';

const trip=(id,over={})=>({id,source:'device',endedAt:10,points:[{latitude:1,longitude:1}],...over});
let pending;
const client={rpc:vi.fn(async(name,args)=>({data:typeof pending==='function'?pending(args):pending,error:null}))};
const recorder={getState:vi.fn(async()=>({trips:[trip('AAAA'),trip('BBBB'),trip('CCCC',{endedAt:null}),trip('DDDD',{source:'tesla'}),trip('EEEE',{points:[]})]}))};
beforeEach(()=>{mock.publish.mockReset().mockResolvedValue({token:'t'});pending=[];client.rpc.mockClear();});

describe('household auto-share',()=>{
 it('does nothing when the server lists nothing pending (older, private, decided or off)',async()=>{
  expect(await shareNewHouseholdActivities({client,recorder})).toEqual({published:[],failed:[]});
  expect(mock.publish).not.toHaveBeenCalled();expect(recorder.getState).not.toHaveBeenCalled();
 });
 it('publishes each pending activity to the household through the normal share path',async()=>{
  pending=[{activity_id:'aaaa'},{activity_id:'bbbb'}];
  const result=await shareNewHouseholdActivities({client,recorder});
  expect(result.published).toEqual(['aaaa','bbbb']);
  expect(mock.publish.mock.calls.map(c=>[c[0].id,c[0].audience,c[0].mode])).toEqual([['AAAA','household','household'],['BBBB','household','household']]);
 });
 it('skips activities that are not complete GPS recordings on this phone',async()=>{
  pending=[{activity_id:'cccc'},{activity_id:'dddd'},{activity_id:'eeee'},{activity_id:'ffff'}];
  expect((await shareNewHouseholdActivities({client,recorder})).published).toEqual([]);
  expect(mock.publish).not.toHaveBeenCalled();
 });
 it('one activity that cannot be published does not hold up the others; repeated failures stop the pass',async()=>{
  pending=[{activity_id:'aaaa'},{activity_id:'bbbb'}];
  mock.publish.mockRejectedValueOnce(new Error('Activity changed')).mockResolvedValue({token:'t'});
  const result=await shareNewHouseholdActivities({client,recorder});
  expect(result.published).toEqual(['bbbb']);expect(result.failed[0].message).toMatch(/changed/);
  mock.publish.mockReset().mockRejectedValue(new Error('Set your Home place before sharing'));
  pending=[{activity_id:'aaaa'},{activity_id:'bbbb'},{activity_id:'aaaa'},{activity_id:'bbbb'}];
  const stuck=await shareNewHouseholdActivities({client,recorder});
  expect(stuck.published).toEqual([]);expect(mock.publish.mock.calls.length).toBeLessThanOrEqual(3);
 });
 it('never publishes an activity that was marked private while it was being recorded, even if the server has not heard',async()=>{
  recorder.getState.mockResolvedValueOnce({trips:[trip('HIDDEN'),trip('BBBB')]});
  pending=[{activity_id:'hidden'},{activity_id:'bbbb'}];
  expect((await shareNewHouseholdActivities({client,recorder})).published).toEqual(['bbbb']);
 });
 it('pages past activities this phone cannot publish, so newer ones are still shared',async()=>{
  const elsewhere=Array.from({length:25},(_,i)=>({activity_id:'zzzz'+i}));
  pending=args=>args.p_exclude.length?[{activity_id:'aaaa'}]:elsewhere;
  const result=await shareNewHouseholdActivities({client,recorder});
  expect(result.published).toEqual(['aaaa']);
  expect(client.rpc.mock.calls[1][1].p_exclude.length).toBe(25);
 });
 it('survives the server migration not being applied',async()=>{
  client.rpc.mockResolvedValueOnce({data:null,error:{message:'function does not exist'}});
  expect(await shareNewHouseholdActivities({client,recorder})).toEqual({published:[],failed:[]});
 });
});
