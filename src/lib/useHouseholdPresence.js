import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {supabase} from './supabase.js';
import {recorder,recorderAvailable} from './recorder.js';
import {config} from './config.js';
import {sharedPosition} from './sharedPosition.js';
import {App as NativeApp} from '@capacitor/app';
import {DELIVERY_REPORT_MS,deliveryLatency,joinHouseholdSignals,latencySummary,pollDelay,publishDelay,publishLiveLocation,reconnectDelay,sharedLocationPayload,throttled} from './householdRealtime.js';

const missingFunction=error=>error?.code==='PGRST202'||/could not find the function|does not exist/i.test(error?.message||'');
// A shutdown requested while offline is remembered until the server accepts it.
// The position is already gone locally; this only prevents the old server row
// from continuing to look live on other people's maps.
const revokeKey=owner=>`letm3go-live-revoke:${owner}`;
const revokePending=owner=>{try{return localStorage.getItem(revokeKey(owner))==='1';}catch{return false;}};
const rememberRevoke=(owner,on)=>{try{on?localStorage.setItem(revokeKey(owner),'1'):localStorage.removeItem(revokeKey(owner));}catch{return;}};
// Household members and their authorised positions. Falls back to the earlier
// RPC (members seen within 90 s) until the 20261104 migration is applied.
export async function loadHouseholdLocations(){
 const result=await supabase.rpc('my_household_location_status');
 if(!result.error)return result.data||[];
 if(!missingFunction(result.error))throw new Error('Household locations could not be loaded. Check your connection and retry.');
 const legacy=await supabase.rpc('my_household_live_locations');
 if(legacy.error)throw new Error('Household locations could not be loaded. Check your connection and retry.');
 const now=new Date().toISOString();
 return (legacy.data||[]).map(row=>({...row,sharing_enabled:true,location_at:row.updated_at,server_now:now}));
}
// The caller's own arrival time. Optional: before the 20261106 migration, or on
// any failure, the map simply shows no duration for you.
export async function loadOwnArrival(){
 try{
  const result=await supabase.rpc('my_live_location_arrival');
  const row=result.error?null:result.data?.[0];
  return row?.arrived_at?{arrived_at:row.arrived_at,location_at:row.location_at,server_now:row.server_now}:null;
 }catch{return null;}
}
export function useHouseholdPresence(owner,online,automaticActivity=null,places=[],nativeUploadAt=0){
 const signalled=useRef(false),positionTimes=useRef(new Map()),latencies=useRef([]),latencyReportedAt=useRef(0),nativeUpload=useRef(0),signals=useRef(0),refreshTimes=useRef([]);
 // Only the newest position read may replace state. Two overlapping reads (a
 // signal and a poll) can otherwise apply an older response after a newer one.
 const positionRequest=useRef(0),settingsRequest=useRef(0),reconnects=useRef(0);
 useEffect(()=>{nativeUpload.current=nativeUploadAt;},[nativeUploadAt]);
 const lastAutomatic=useRef(undefined), lastPlace=useRef(null), lastPlaceSentAt=useRef(0), locationBusy=useRef(false);
 const [people,setPeople]=useState([]),[self,setSelf]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [liveEnabled,setLiveEnabled]=useState(false),[liveMembers,setLiveMembers]=useState([]),[liveError,setLiveError]=useState(''),[liveReady,setLiveReady]=useState(false);
 // When you arrived where you are, as your household sees it (null when unknown).
 const [selfArrival,setSelfArrival]=useState(null);
 // Members with an authorised position (live or stale); every member is in liveMembers.
 const livePeople=useMemo(()=>liveMembers.filter(m=>m.sharing_enabled&&Number.isFinite(m.latitude)&&Number.isFinite(m.longitude)),[liveMembers]);
 const liveBusy=useRef(false),liveConsent=useRef(false);
 // Last confirmed in-app send; the native uploader reports its own separately.
 const [lastPublishedAt,setLastPublishedAt]=useState(0);
 const refresh=useCallback(async()=>{
  if(!owner||!online||!supabase)return;
  const [mine,others]=await Promise.all([supabase.rpc('my_presence_settings'),supabase.rpc('my_household_presence')]);
  if(mine.error||others.error){setError('Social presence is unavailable. The database migration may not be deployed.');return;}
  setSelf(mine.data?.[0]||{sharing_enabled:false});setPeople(others.data||[]);setError('');
 },[owner,online]);
 useEffect(()=>{if(!online)return;const load=()=>{if(document.visibilityState==='visible')void refresh();};const initial=setTimeout(load,0);const timer=setInterval(load,15000);document.addEventListener('visibilitychange',load);return()=>{clearTimeout(initial);clearInterval(timer);document.removeEventListener('visibilitychange',load);};},[refresh,online]);
 useEffect(()=>{
  if(!owner||!online||!supabase||self?.sharing_enabled!==true){lastAutomatic.current=undefined;lastPlace.current=null;lastPlaceSentAt.current=0;return;}
  if(lastAutomatic.current===automaticActivity)return;
  if(!automaticActivity&&lastPlace.current==='Home')return;
  lastAutomatic.current=automaticActivity;
  if(automaticActivity)lastPlace.current=null;
  let cancelled=false;
  const send=async()=>{
   const {error:failure}=await supabase.rpc('set_household_presence',{p_enabled:true,p_activity:automaticActivity,p_place:null});
   if(failure&&!cancelled)setError('Automatic activity sharing could not update.');
   if(!failure&&!cancelled)void refresh();
  };
  void send();
  return()=>{cancelled=true;};
 },[owner,online,self?.sharing_enabled,automaticActivity,refresh]);

 const home=places.find(p=>p.kind==='home');
 const homeId=home?.id,homeLatitude=home?.latitude,homeLongitude=home?.longitude,homeRadius=home?.radius;
 useEffect(()=>{
  if(!owner||!online||!supabase||!recorderAvailable()||!homeId||self?.sharing_enabled!==true)return;
  let alive=true;
  const check=async()=>{
   if(!alive||document.visibilityState==='hidden'||locationBusy.current||automaticActivity)return;
   locationBusy.current=true;
   try {
    const point=await recorder.currentPosition({allowStationary:true});
    // Still where the last check found the phone: nothing to update.
    if(point?.stationary)return;
    if(!alive||!point||!Number.isFinite(point.latitude)||!Number.isFinite(point.longitude)||point.accuracy>100)return;
    const radians=Math.PI/180,dlat=(point.latitude-homeLatitude)*radians,dlon=(point.longitude-homeLongitude)*radians;
    const a=Math.sin(dlat/2)**2+Math.cos(point.latitude*radians)*Math.cos(homeLatitude*radians)*Math.sin(dlon/2)**2;
    const within=6371000*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))<=Math.max(50,Math.min(2000,Number(homeRadius)||150));
    const next=within?'Home':null;
    if(next===lastPlace.current && (!within || Date.now()-lastPlaceSentAt.current<900000))return;
    if(!within&&lastPlace.current!=='Home'&&self?.activity_label!=='At home')return;
    const {error:failure}=await supabase.rpc('set_household_presence',{p_enabled:true,p_activity:within?'At home':null,p_place:next});
    if(!failure&&alive){lastPlace.current=next;lastPlaceSentAt.current=Date.now();void refresh();}
   }catch{/* GPS unavailable: never guess household presence. */}
   finally{locationBusy.current=false;}
  };
  void check();
  const timer=setInterval(()=>void check(),300000);
  const onVisible=()=>{if(document.visibilityState==='visible')void check();};
  document.addEventListener('visibilitychange',onVisible);
  return()=>{alive=false;clearInterval(timer);document.removeEventListener('visibilitychange',onVisible);};
 },[owner,online,self?.sharing_enabled,self?.activity_label,automaticActivity,homeId,homeLatitude,homeLongitude,homeRadius,refresh]);

 // Every household member with their sharing state; coordinates only where the
 // server authorises them. A failed fetch keeps the last rows (with their own
 // ages) and reports the error, so a membership result is never mistaken for a
 // location result and a network blip never blanks the map.
 const noteDelivery=useCallback(rows=>{
  latencies.current.push(...deliveryLatency(rows,positionTimes.current));
  const clock=Date.now();
  if(clock-latencyReportedAt.current<DELIVERY_REPORT_MS||!latencies.current.length)return;
  latencyReportedAt.current=clock;
  const ages=rows.map(row=>{
   const at=Date.parse(row.location_at),now=Date.parse(row.server_now);
   return Number.isFinite(at)&&Number.isFinite(now)?Math.max(0,Math.round((now-at)/1000)):null;
  }).filter(Number.isFinite);
  void recorder.noteHouseholdDelivery?.({...latencySummary(latencies.current),transport:signalled.current?'push':'polling',signalsReceived:signals.current,refreshMedianMs:latencySummary(refreshTimes.current)?.latencyMedianMs??0,viewerLastPositionAgeSeconds:ages.length?Math.min(...ages):-1,realtimeReconnects:reconnects.current});
  latencies.current=[];signals.current=0;refreshTimes.current=[];
 },[]);
 const refreshLive=useCallback(async()=>{
  if(!owner||!online||!supabase)return;
  const request=++positionRequest.current,settingsToken=++settingsRequest.current;
  try{
   const [settings,members,arrival]=await Promise.all([supabase.rpc('my_live_location_settings'),loadHouseholdLocations(),loadOwnArrival()]);
   if(settings.error)throw new Error('Location sharing could not be loaded. Check your connection and retry.');
   // Settings and positions have separate races. A push-driven position read
   // must not cancel the initial settings read that arms the native uploader.
   if(settingsToken===settingsRequest.current){
    const enabled=settings.data?.[0]?.enabled===true&&!revokePending(owner);
    liveConsent.current=enabled;
    setLiveEnabled(enabled);setSelfArrival(enabled?arrival:null);setLiveError('');setLiveReady(true);
   }
   if(request===positionRequest.current){setLiveMembers(members);noteDelivery(members);}
  }catch(err){if(settingsToken===settingsRequest.current)setLiveError(err.message||'Location sharing could not be loaded.');}
 },[owner,online,noteDelivery]);
 // A signal only needs the positions: this one read, not the settings and arrival too.
 const refreshPositions=useCallback(async()=>{
  if(!owner||!online||!supabase)return;
  const request=++positionRequest.current;
  try{
   const started=Date.now();
   const members=await loadHouseholdLocations();
   if(request!==positionRequest.current)return;
   refreshTimes.current.push(Date.now()-started);
   setLiveMembers(members);setLiveError('');
   noteDelivery(members);
  }catch{/* The next poll reports it; a missed signal must not raise an error. */}
 },[owner,online,noteDelivery]);
 const memberKey=useMemo(()=>liveMembers.map(member=>member.user_id).sort().join(','),[liveMembers]);
 useEffect(()=>{
  if(!online)return;
  let alive=true,listener,timer;
  const poll=()=>{if(document.visibilityState==='visible')void refreshLive();};
  // Decided each round: a dropped channel returns to the fast poll within one wait.
  const next=()=>{timer=setTimeout(()=>{poll();next();},signalled.current?pollDelay(true):pollDelay(false));};
  const start=setTimeout(()=>{poll();next();},0);
  document.addEventListener('visibilitychange',poll);
  window.addEventListener('online',poll);
  if(recorderAvailable())void NativeApp.addListener('appStateChange',({isActive})=>{if(isActive)void refreshLive();}).then(handle=>{if(alive)listener=handle;else void handle.remove();}).catch(()=>{});
  return()=>{alive=false;clearTimeout(start);clearTimeout(timer);document.removeEventListener('visibilitychange',poll);window.removeEventListener('online',poll);void listener?.remove();};
 },[online,refreshLive]);
 // Push: a member's location changed, so read the authorised rows now. Without the
 // 20261108 migration, or with Realtime down, polling above carries on alone.
 // Discovery, the first join, channel failure and a foreground/network return all
 // retry with bounded backoff, so a single failed join does not leave the viewer
 // on the slow poll for the rest of the session.
 useEffect(()=>{
  if(!online||!owner||!supabase)return;
  let alive=true,stop=null,retry=null,deadline=null,joining=false,connected=false,everConnected=false,closed=false,attempt=0;
  const read=throttled(()=>{if(document.visibilityState==='visible')void refreshPositions();});
  const signal=()=>{signals.current+=1;read();};
  const schedule=()=>{
   if(!alive||retry)return;
   retry=setTimeout(()=>{retry=null;void connect();},reconnectDelay(attempt++));
  };
  async function connect(){
   if(!alive||joining)return;
   clearTimeout(retry);retry=null;
   const previous=stop;stop=null;connected=false;signalled.current=false;clearTimeout(deadline);deadline=null;
   if(previous){closed=true;previous();closed=false;}
   joining=true;
   try{
    const {data,error}=await supabase.rpc('my_household_signal_topics');
    if(!alive)return;
    const topics=(data||[]).map(row=>row.topic).filter(Boolean);
    if(error||!topics.length){schedule();return;}
    const leave=await joinHouseholdSignals(supabase,topics,{onSignal:signal,onState:nowConnected=>{
     if(!alive)return;
     if(nowConnected){
      if(!connected){
       if(everConnected)reconnects.current+=1;
       everConnected=true;
      }
      connected=true;attempt=0;clearTimeout(deadline);deadline=null;
      // Joining (or rejoining) catches up on whatever was missed while away.
      if(!signalled.current)read();
      signalled.current=true;
     }else if(connected&&!closed){
      connected=false;signalled.current=false;schedule();
     }
    }});
    if(!alive){leave();return;}
    stop=leave;
    deadline=setTimeout(()=>{if(alive&&!connected){connected=false;signalled.current=false;stop?.();stop=null;schedule();}},15000);
   }catch{if(alive)schedule();}
   finally{joining=false;}
  }
  const retryNow=()=>{if(!alive||connected)return;clearTimeout(retry);retry=null;attempt=0;void connect();};
  const visible=()=>{if(document.visibilityState==='visible')retryNow();};
  window.addEventListener('online',retryNow);
  document.addEventListener('visibilitychange',visible);
  void connect();
  return()=>{alive=false;clearTimeout(retry);clearTimeout(deadline);read.cancel();stop?.();signalled.current=false;
   window.removeEventListener('online',retryNow);document.removeEventListener('visibilitychange',visible);};
 // memberKey: joining or leaving a household changes which channels apply.
 },[online,owner,refreshPositions,memberKey]);
 // Keep the native uploader armed with a short-lived session only while
 // the owner has separately opted into precise family sharing. Native tracking
 // uses existing Core Location callbacks when JavaScript is suspended.
 useEffect(()=>{
  if(!recorderAvailable()||!online||!owner)return;
  let alive=true;
  const arm=async()=>{
   if(!liveEnabled){
    await recorder.configureLiveSharing({enabled:false}).catch(()=>{});
    return;
   }
   // Preferred: a device credential that keeps a locked or relaunched phone
   // publishing. Reissued only when the phone lacks one or it expires within a week.
   const native=(await recorder.getState().catch(()=>null))?.nativeFamilySharing;
   if(!alive)return;
   if(native?.armed&&native.mode==='device'&&native.tokenExpiresAt>Date.now()/1000+7*86400)return;
   const issued=await supabase.rpc('issue_my_live_location_token');
   if(!alive)return;
   const credential=issued.data?.[0];
   if(!issued.error&&credential?.publish_token){
    await recorder.configureLiveSharing({
     enabled:true,publishToken:credential.publish_token,expiresAt:Date.parse(credential.valid_until)/1000,
     endpoint:config.url+'/rest/v1/rpc/publish_live_location',apiKey:config.key
    }).catch(()=>{});
    return;
   }
   if(issued.error&&!missingFunction(issued.error))return;
   // The database is not migrated yet: fall back to the one-hour session token.
   const {data:{session},error}=await supabase.auth.getSession();
   if(!alive||error||session?.user?.id!==owner||!session?.expires_at)return;
   await recorder.configureLiveSharing({
    enabled:true,accessToken:session.access_token,expiresAt:session.expires_at,
    endpoint:config.url+'/rest/v1/rpc/set_my_live_location',apiKey:config.key
   }).catch(()=>{});
  };
  void arm();
  const timer=setInterval(()=>void arm(),120000);
  const foreground=()=>{if(document.visibilityState==='visible')void arm();};
  document.addEventListener('visibilitychange',foreground);
  return()=>{alive=false;clearInterval(timer);document.removeEventListener('visibilitychange',foreground);};
 },[owner,online,liveEnabled]);
 const setLiveSharing=async enabled=>{
  if(!enabled){
   // Privacy first: stop the native publisher before any network round trip.
   // This must work with no connection at all.
   liveConsent.current=false;setLiveEnabled(false);setLastPublishedAt(0);setLiveError('');setLiveReady(true);
   rememberRevoke(owner,true);
   await recorder.configureLiveSharing({enabled:false}).catch(()=>{});
   let failure;
   if(online){
    try{({error:failure}=await supabase.rpc('set_my_live_location',{p_enabled:false}));}catch(error){failure=error;}
   }else failure={message:'The server revoke will retry when you are online.'};
   if(!failure)rememberRevoke(owner,false);
   await refreshLive();
   setLiveError(failure?'Location sharing is off on this phone. The server revoke will retry when you are online.':'');
   return;
  }
  if(!supabase||!online)throw new Error('Connect to change location sharing.');
  const fix=await sharedPosition();
  // Turning sharing on is a consent action, not a position update. The database
  // refuses to re-enable a disabled row from any fix, however new it is; this
  // status-only call is the explicit action that records the user's consent.
  const {error:consentFailure}=await supabase.rpc('set_my_live_location',{p_enabled:true});
  if(consentFailure)throw new Error(consentFailure.message||'Could not change location sharing.');
  rememberRevoke(owner,false);
  liveConsent.current=true;
  setLiveEnabled(true);setLiveReady(true);
  lastPlaceSentAt.current=0;
  const {error:failure}=await publishLiveLocation(supabase,sharedLocationPayload(fix));
  await refreshLive();
  if(failure){
   setLiveError('Location sharing is on, but the first position could not be sent.');
   return;
  }
  setLastPublishedAt(Date.now());
  setLiveError('');
 };
 // Offline shutdown leaves a marker. Retry only while the local intent is still
 // "off"; a later enable must not be undone by a stale revocation.
 useEffect(()=>{
  if(!owner||!online||!supabase||!revokePending(owner))return;
  let alive=true;
  const retry=async()=>{
   if(!alive||liveConsent.current)return;
   const {error}=await supabase.rpc('set_my_live_location',{p_enabled:false});
   if(!alive||error)return;
   rememberRevoke(owner,false);setLiveError('');await refreshLive();
  };
  void retry();
  const timer=setInterval(()=>void retry(),30000);
  window.addEventListener('online',retry);
  return()=>{alive=false;clearInterval(timer);window.removeEventListener('online',retry);};
 },[owner,online,refreshLive]);
 useEffect(()=>{
  if(!owner||!online||!liveEnabled||!recorderAvailable())return;
  let alive=true,timer,delay=publishDelay(null);
  const send=async()=>{
   if(!alive||document.visibilityState==='hidden'||liveBusy.current)return;
   // A moving phone with continuous GPS already publishes from native code.
   if(Date.now()/1000-nativeUpload.current<10)return;
   liveBusy.current=true;
   try{
    const position=await recorder.currentPosition({allowStationary:true,maxAge:delay<publishDelay(null)?3:undefined});
    // Core Location reports the phone has not moved: the native publisher
    // re-confirms the shared position, so no precise fix is requested here.
    if(position?.stationary)return;
    if(!alive||!liveConsent.current||!position||!Number.isFinite(position.latitude)||!Number.isFinite(position.longitude)||
      !Number.isFinite(position.accuracy)||position.accuracy<0||position.accuracy>100)return;
    // Speed and time come from Core Location; never send inferred fixes. A fix
    // queued offline is sent with its real capture time and true age.
    const age=Date.now()/1000-position.timestamp;
    if(!Number.isFinite(position.timestamp)||age>600||age<-5)return;
    delay=publishDelay(position.speed);
    if(!liveConsent.current)return;
    const {error:failure}=await publishLiveLocation(supabase,sharedLocationPayload(position));
    if(failure&&alive){setLiveError('Unable to update live location.');delay=publishDelay(null);}
    if(!failure&&alive)setLastPublishedAt(Date.now());
   }catch{/* Never replace the last confirmed location with a guess. */}
   finally{liveBusy.current=false;}
  };
  const loop=()=>{timer=setTimeout(async()=>{await send();if(alive)loop();},delay);};
  void send().then(()=>{if(alive)loop();});
  const visible=()=>{if(document.visibilityState==='visible')void send();};
  document.addEventListener('visibilitychange',visible);
  return()=>{alive=false;clearTimeout(timer);document.removeEventListener('visibilitychange',visible);};
 },[owner,online,liveEnabled]);
 const update=async(enabled,activity=null,place=null)=>{
  if(!online||!supabase)throw new Error('Connect to change live visibility securely.');
  setBusy(true);
  try{
   const {error:failure}=await supabase.rpc('set_household_presence',{p_enabled:enabled,p_activity:activity,p_place:place});
   if(failure)throw new Error(failure.message||'Visibility update failed.');
   await refresh();
  }finally{setBusy(false);}
 };
 return {people,self,error,busy,refresh,update,liveEnabled,liveMembers,livePeople,lastPublishedAt,liveError,liveReady,setLiveSharing,refreshLive,selfArrival};
}
