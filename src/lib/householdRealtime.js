// Household map delivery. A private Realtime channel says that someone's location
// changed and the app re-reads through my_household_location_status(), so no
// position travels over Realtime and the server stays the only access check.
// Polling remains as the fallback, and slows down only while the channel is up.
export const POLL_MS=15000;
export const POLL_CONNECTED_MS=60000;
export const SIGNAL_THROTTLE_MS=1000;
export const DELIVERY_REPORT_MS=60000;
export const PUBLISH_MOVING_MS=5000;
export const PUBLISH_STILL_MS=30000;
export const MOVING_SPEED=1;
export const pollDelay=connected=>connected?POLL_CONNECTED_MS:POLL_MS;
export const publishDelay=speed=>Number.isFinite(speed)&&speed>=MOVING_SPEED?PUBLISH_MOVING_MS:PUBLISH_STILL_MS;
// The only fields of a fix that reach a household: an allowlist, so nothing added to
// a position later can start travelling by accident.
export function sharedLocationPayload(fix){
 const speed=Number.isFinite(fix?.speed)&&fix.speed>=0?Math.max(0,Math.min(250,fix.speed*3.6)):null;
 return {p_enabled:true,p_latitude:fix.latitude,p_longitude:fix.longitude,p_accuracy:fix.accuracy,p_speed:speed};
}
// One read at the leading edge and one after a burst, however many signals arrive.
export function throttled(run,ms=SIGNAL_THROTTLE_MS,{now=()=>Date.now(),later=setTimeout,cancel=clearTimeout}={}){
 let last=-Infinity,timer=null;
 const fire=()=>{timer=null;last=now();run();};
 const call=()=>{
  if(timer!=null)return;
  const wait=last+ms-now();
  if(wait<=0)fire();else timer=later(fire,wait);
 };
 call.cancel=()=>{if(timer!=null)cancel(timer);timer=null;};
 return call;
}
// `onState(connected)` reports whether every channel is joined. Reconnecting is
// supabase-js's job; a client that never joins simply keeps polling.
// A private channel is checked against the caller's token, so that token must reach
// Realtime before joining. supabase-js then renews it on each refresh.
export async function joinHouseholdSignals(client,topics,handlers){
 await client.realtime?.setAuth?.();
 return subscribeHouseholdSignals(client,topics,handlers);
}
export function subscribeHouseholdSignals(client,topics,{onSignal,onState}){
 const joined=new Set();
 const channels=topics.map(topic=>client.channel(topic,{config:{private:true}})
  .on('broadcast',{event:'location'},()=>onSignal())
  .subscribe(status=>{
   if(status==='SUBSCRIBED')joined.add(topic);else joined.delete(topic);
   onState(joined.size===topics.length&&topics.length>0);
  }));
 return ()=>{onState(false);for(const channel of channels)void client.removeChannel(channel);};
}
// Capture-to-screen delay, for the diagnostic log only. Each position counts once.
export function deliveryLatency(rows,seen){
 const out=[];
 for(const row of rows){
  const at=Date.parse(row.location_at),reference=Date.parse(row.server_now);
  if(!Number.isFinite(at)||!Number.isFinite(reference)||seen.get(row.user_id)===at)continue;
  const first=!seen.has(row.user_id);
  seen.set(row.user_id,at);
  if(!first)out.push(Math.max(0,reference-at));
 }
 return out;
}
export function latencySummary(samples){
 if(!samples.length)return null;
 const sorted=[...samples].sort((a,b)=>a-b);
 return {latencySamples:sorted.length,latencyMedianMs:Math.round(sorted[Math.floor(sorted.length/2)]),latencyMaxMs:Math.round(sorted.at(-1))};
}
