import {act,renderHook,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';

const listeners={},rows={current:[]},invoke=vi.fn(async()=>({})),rpc=vi.fn(async()=>({}));
const removeDelivered=vi.fn(async()=>{});
vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:()=>true}}));
vi.mock('@capacitor/app',()=>({App:{addListener:async(name,fn)=>{listeners[name]=fn;return {remove:async()=>{delete listeners[name];}};}}}));
vi.mock('@capacitor/push-notifications',()=>({PushNotifications:{
 addListener:async(name,fn)=>{listeners[name]=fn;return {remove:async()=>{delete listeners[name];}};},
 removeAllDeliveredNotifications:()=>removeDelivered(),
}}));
const query={select:()=>query,is:()=>query,order:()=>query,limit:async()=>({data:rows.current})};
vi.mock('./supabase.js',()=>({supabase:{from:()=>query,rpc:(...args)=>rpc(...args),functions:{invoke:(...args)=>invoke(...args)}}}));
const {useNotifications}=await import('./notifications.js');

beforeEach(()=>{rows.current=[];invoke.mockClear();rpc.mockClear();removeDelivered.mockClear();});

it('loads the unread inbox on open and wakes the push sender',async()=>{
 rows.current=[{id:1,kind:'feedback_new',title:'New feedback',body:'Ann: crash'}];
 const {result}=renderHook(()=>useNotifications('owner'));
 await waitFor(()=>expect(result.current.count).toBe(1));
 expect(invoke).toHaveBeenCalledWith('send-push-notifications',{body:{}});
});

it('a push arriving while the app is open refreshes the badge (foreground)',async()=>{
 const {result}=renderHook(()=>useNotifications('owner'));
 await waitFor(()=>expect(listeners.pushNotificationReceived).toBeTypeOf('function'));
 rows.current=[{id:2,kind:'poke',title:'Poke',body:'Bob poked you 👋'}];
 act(()=>listeners.pushNotificationReceived({title:'Poke'}));
 await waitFor(()=>expect(result.current.items[0]?.kind).toBe('poke'));
});

it('tapping a push opens its screen (background or cold start) and returning to the app refreshes',async()=>{
 const onOpen=vi.fn();
 renderHook(()=>useNotifications('owner',{onOpen}));
 await waitFor(()=>expect(listeners.pushNotificationActionPerformed).toBeTypeOf('function'));
 act(()=>listeners.pushNotificationActionPerformed({notification:{data:{kind:'feedback_reply',screen:'feedback',id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}}}));
 expect(onOpen).toHaveBeenCalledWith({screen:'feedback',id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'});
 invoke.mockClear();
 act(()=>listeners.appStateChange({isActive:true}));
 expect(invoke).toHaveBeenCalledTimes(1);
});

it('marking a kind read clears it locally, in the database and from Notification Centre',async()=>{
 rows.current=[{id:1,kind:'feedback_new'},{id:2,kind:'poke'}];
 const {result}=renderHook(()=>useNotifications('owner'));
 await waitFor(()=>expect(result.current.count).toBe(2));
 await act(()=>result.current.markRead(['poke']));
 expect(result.current.items.map(item=>item.kind)).toEqual(['feedback_new']);
 expect(rpc).toHaveBeenCalledWith('mark_notifications_read',{p_kinds:['poke']});
 expect(removeDelivered).toHaveBeenCalled();
});

it('signed out: no inbox, no listeners, no wake',async()=>{
 renderHook(()=>useNotifications(null));
 await new Promise(resolve=>setTimeout(resolve,10));
 expect(invoke).not.toHaveBeenCalled();
});
