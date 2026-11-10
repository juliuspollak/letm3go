import {describe,expect,it,vi} from 'vitest';
vi.mock('./supabase.js',()=>({supabase:null}));
import {badgeText,countKinds,notificationTarget,sendPoke,FEEDBACK_KINDS,SEGMENT_KINDS} from './notifications.js';

describe('notifications',()=>{
 it('routes a tapped push or an inbox row to its screen',()=>{
  const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  expect(notificationTarget({screen:'feedback',id})).toEqual({screen:'feedback',id});
  expect(notificationTarget({route:{screen:'review'}})).toEqual({screen:'review'});
  expect(notificationTarget({screen:'home',from:id})).toEqual({screen:'home'});
  // Segment notifications open that segment, from the inbox (route) or a push (flat).
  expect(notificationTarget({route:{screen:'segment',id}})).toEqual({screen:'segment',id});
  expect(notificationTarget({screen:'segment',id,kind:'segment_pb'})).toEqual({screen:'segment',id});
  expect(notificationTarget({screen:'segment'})).toBeNull();
  expect(notificationTarget({screen:'settings'})).toBeNull();
  expect(notificationTarget(null)).toBeNull();
 });
 it('counts badges per area',()=>{
  const items=[{kind:'feedback_new'},{kind:'feedback_status'},{kind:'segment_pb'},{kind:'segment_completed'},{kind:'poke'}];
  expect(countKinds(items,FEEDBACK_KINDS)).toBe(2);
  expect(countKinds(items,SEGMENT_KINDS)).toBe(2);
 });
 it('shows at most 9 on the badge',()=>{
  expect([1,9,10,57].map(badgeText)).toEqual(['1','9','9+','9+']);
 });
 it('pokes through the database only; the database dispatches the push',async()=>{
  const invoke=vi.fn(async()=>({})),rpc=vi.fn(async()=>({data:'Ann poked you 👋'}));
  await expect(sendPoke('b',{rpc,functions:{invoke}})).resolves.toBe('Ann poked you 👋');
  expect(rpc).toHaveBeenCalledWith('send_poke',{p_to:'b'});
  expect(invoke).not.toHaveBeenCalled();
 });
 it('reports a refused poke',async()=>{
  const invoke=vi.fn(),rpc=vi.fn(async()=>({error:{message:'You just poked them. Try again in a minute.'}}));
  await expect(sendPoke('b',{rpc,functions:{invoke}})).rejects.toThrow('in a minute');
  expect(invoke).not.toHaveBeenCalled();
 });
});
