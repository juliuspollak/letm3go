import {useEffect,useMemo,useRef,useState} from 'react';
import {useAuth} from '../lib/AuthContext.jsx';
import {supabase} from '../lib/supabase.js';
import {activityPresentation} from '../lib/activityPresentation.js';
import {acceptNativeMutation,activityDetailsRequests} from '../lib/activityDetailsRequests.js';
import {disableNativeDetails,nativeDetails} from '../lib/nativeActivityDetails.js';
import {savedMaximum} from '../lib/heartRate.js';
import ActivityDetail from './ActivityDetail.jsx';

// While a screen is replaced by the next activity React unmounts and mounts in the
// same turn. The native screen, its map and its panel survive that hand-over;
// closing waits a turn so only a real exit closes them.
const session={owner:0,open:false,closing:null,revision:0};
const LIVE_UPDATE_MS=2000;
const NONE=[];

// Same props and the same entry points as ActivityDetail: everything that opens an
// activity keeps working, and this renders nothing of its own while the native
// screen covers the web view.
// A recording changes with every fix. Projecting a long route is the expensive step,
// so a recording is read at most this often; anything else passes straight through.
function useLiveTrip(trip){
 const [held,setHeld]=useState(()=>({trip,at:Date.now()}));
 const recording=trip.state==='recording'&&held.trip.id===trip.id&&held.trip.state==='recording';
 useEffect(()=>{
  if(!recording||held.trip===trip)return;
  const timer=setTimeout(()=>setHeld({trip,at:Date.now()}),Math.max(0,LIVE_UPDATE_MS-(Date.now()-held.at)));
  return()=>clearTimeout(timer);
 },[recording,held,trip]);
 return recording?held.trip:trip;
}

export default function NativeActivityDetail(props){
 const {ownerID,trip:latest,activities,journeys,places=NONE,vehicles=NONE,onBack,onDeleted,onUpdated,onSource,run,grouping,journeyGrouping,unit='km',onAddEquipment}=props;
 const trip=useLiveTrip(latest);
 const auth=useAuth();
 const [failed,setFailed]=useState(false);
 const [selectedPhotoID,setSelectedPhotoID]=useState(null);
 const [heartVersion,setHeartVersion]=useState(0);
 const maximumHeartRate=useMemo(()=>{void heartVersion;return savedMaximum(ownerID);},[ownerID,heartVersion]);
 // Only what the projection reads, not the grouping object, which is new on every
 // App render: a long route must not be projected again for an unrelated change.
 const metadata=grouping?.metadata,destinations=grouping?.destinations,groupedJourneys=grouping?.journeys;
 const presentation=useMemo(()=>activityPresentation(trip,{ownerID,activities,places,vehicles,grouping:metadata?{metadata,destinations,journeys:groupedJourneys}:null,unit,maximumHeartRate,selectedPhotoID,canOpenActivities:Boolean(onSource)}),[trip,ownerID,activities,places,vehicles,metadata,destinations,groupedJourneys,unit,maximumHeartRate,selectedPhotoID,onSource]);
 // Native requests read the current account, activity and callbacks when they run.
 const context=useRef(null);
 const handlers=useRef(null);
 useEffect(()=>{
  context.current={client:supabase,trip,ownerID,activities:journeys||activities||[],grouping:grouping||journeyGrouping,run,auth,onSource,addEquipmentItem:onAddEquipment,refreshPresentation:()=>setHeartVersion(version=>version+1)};
  handlers.current={onBack,onDeleted,onUpdated,run};
 });

 // Requests in flight, so a screen that goes away stops a long place scan.
 const pending=useRef(new Map());
 useEffect(()=>{
  const owner=++session.owner;
  clearTimeout(session.closing);session.closing=null;
  const listeners=[];
  const running=pending.current;
  const add=(event,callback)=>{void nativeDetails.addListener(event,callback).then(handle=>{if(session.owner===owner)listeners.push(handle);else void handle.remove();}).catch(()=>{});};
  add('request',async({requestID,op,args})=>{
   const controller=new AbortController();
   running.set(requestID,controller);
   const operation=activityDetailsRequests[op];
   try{
    if(!operation)throw new Error('This action is not available in this version.');
    const result=await operation(context.current,args||{},{signal:controller.signal,progress:notice=>void nativeDetails.respond({requestID,progress:notice}).catch(()=>{})});
    await nativeDetails.respond({requestID,ok:true,result:result||{}});
   }catch(error){
    await nativeDetails.respond({requestID,ok:false,message:error?.message||'That action could not be completed.'}).catch(()=>{});
   }finally{running.delete(requestID);}
  });
  add('cancelRequest',({requestID})=>running.get(requestID)?.abort());
  add('mutation',({activityID,kind})=>{
   if(activityID!==context.current.trip.id)return;
   void acceptNativeMutation({run:handlers.current.run,onUpdated:handlers.current.onUpdated,onDeleted:handlers.current.onDeleted,activityID,kind});
  });
  add('photoSelected',({photoID})=>setSelectedPhotoID(photoID));
  add('closed',()=>{session.open=false;handlers.current.onBack?.();});
  return()=>{
   // A listener still registering sees the changed owner and removes itself.
   session.owner+=1;
   for(const handle of listeners)void handle.remove();
   for(const controller of running.values())controller.abort();
   running.clear();
   session.closing=setTimeout(()=>{session.closing=null;session.open=false;void nativeDetails.dismiss().catch(()=>{});},0);
  };
 },[]);

 const sent=useRef('');
 useEffect(()=>{
  const key=JSON.stringify(presentation);
  if(key===sent.current)return;
  sent.current=key;
  const message={...presentation,revision:++session.revision};
  if(session.open){void nativeDetails.update(message).catch(()=>{});return;}
  session.open=true;
  void nativeDetails.present(message).catch(()=>{session.open=false;disableNativeDetails();setFailed(true);});
 },[presentation]);

 if(failed)return <ActivityDetail {...props}/>;
 return <div className="native-activity-detail" aria-hidden="true"/>;
}
