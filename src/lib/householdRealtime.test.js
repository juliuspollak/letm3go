import {expect,it,vi} from 'vitest';
import {joinHouseholdSignals,POLL_CONNECTED_MS,POLL_MS,PUBLISH_MOVING_MS,PUBLISH_STILL_MS,deliveryLatency,latencySummary,pollDelay,publishDelay,sharedLocationPayload,subscribeHouseholdSignals,throttled} from './householdRealtime.js';

it('polls fast only while no push channel is up',()=>{
 expect(pollDelay(false)).toBe(POLL_MS);
 expect(pollDelay(true)).toBe(POLL_CONNECTED_MS);
});
it('publishes often while moving and slowly at rest',()=>{
 expect(publishDelay(13)).toBe(PUBLISH_MOVING_MS);
 expect(publishDelay(0.2)).toBe(PUBLISH_STILL_MS);
 expect(publishDelay(-1)).toBe(PUBLISH_STILL_MS);
 expect(publishDelay(undefined)).toBe(PUBLISH_STILL_MS);
});
it('turns a burst of signals into one read now and one after',()=>{
 let time=0;const pending=[];const run=vi.fn();
 const signal=throttled(run,1000,{now:()=>time,later:fn=>{pending.push(fn);return pending.length;},cancel:()=>{}});
 signal();signal();signal();
 expect(run).toHaveBeenCalledTimes(1);
 expect(pending).toHaveLength(1);
 time=1000;pending.pop()();
 expect(run).toHaveBeenCalledTimes(2);
});
function fakeClient(){
 const channels=[];
 return {channels,removed:[],removeChannel(c){this.removed.push(c);},channel(topic,options){
  const c={topic,options,on(_type,filter,handler){c.filter=filter;c.handler=handler;return c;},subscribe(cb){c.status=cb;return c;}};
  channels.push(c);return c;
 }};
}
it('joins a private channel, follows its state and falls back when it drops',()=>{
 const client=fakeClient(),onSignal=vi.fn(),onState=vi.fn();
 const stop=subscribeHouseholdSignals(client,['household:1'],{onSignal,onState});
 const channel=client.channels[0];
 expect(channel.options.config.private).toBe(true);
 expect(channel.filter.event).toBe('location');
 channel.status('SUBSCRIBED');expect(onState).toHaveBeenLastCalledWith(true);
 channel.handler({payload:{user_id:'u'}});expect(onSignal).toHaveBeenCalledTimes(1);
 channel.status('CHANNEL_ERROR');expect(onState).toHaveBeenLastCalledWith(false);
 channel.status('SUBSCRIBED');expect(onState).toHaveBeenLastCalledWith(true);
 stop();expect(client.removed).toEqual([channel]);expect(onState).toHaveBeenLastCalledWith(false);
});
it('hands Realtime the current token before joining a private channel',async()=>{
 const client=fakeClient(),order=[];
 client.realtime={setAuth:async()=>{order.push('auth');}};
 const channel=client.channel.bind(client);client.channel=(...args)=>{order.push('join');return channel(...args);};
 await joinHouseholdSignals(client,['household:1'],{onSignal(){},onState(){}});
 expect(order).toEqual(['auth','join']);
});
it('sends only the allowed fields of a fix',()=>{
 expect(Object.keys(sharedLocationPayload({latitude:1,longitude:2,accuracy:3,speed:1,bpm:150,activity:'Running'})).sort()).toEqual(['p_accuracy','p_enabled','p_latitude','p_longitude','p_speed']);
});
it('measures each new position once and skips the first read',()=>{
 const seen=new Map();
 const row=(at,now)=>({user_id:'u',location_at:new Date(at).toISOString(),server_now:new Date(now).toISOString()});
 expect(deliveryLatency([row(1000,1500)],seen)).toEqual([]);
 expect(deliveryLatency([row(1000,3000)],seen)).toEqual([]);
 expect(deliveryLatency([row(4000,6500)],seen)).toEqual([2500]);
 expect(latencySummary([3000,1000,2000])).toEqual({latencySamples:3,latencyMedianMs:2000,latencyMaxMs:3000});
 expect(latencySummary([])).toBeNull();
});
