import {useEffect,useRef,useState} from 'react';
import {supabase} from './supabase.js';
import {recorder,recorderAvailable} from './recorder.js';
import {liveRoadWork} from './liveRoads.js';
import {routeGaps,gapKey} from './gapReconstruction.js';

// While my own drive is being recorded, rebuild its closed GPS gaps as roads (once
// each) and publish them to my live trail, so people watching see the road section
// as an estimate rather than a hole.
//
// What actually runs where: the recorder is native and keeps recording with the app in
// the background, but this work is JavaScript asking Apple Maps (recorder.roadRoute), and
// iOS suspends the WebView in the background. So roads are rebuilt only while the app is
// open in the foreground; nothing here is promised in the background. Gaps that closed
// meanwhile are picked up when the app returns, and the finished drive gets its roads
// from the normal pass (useJourneyGrouping) either way.
//
// `trip` is the recorder's in-progress automatic activity (state.automaticTrip), the
// only place a drive in progress exists.
const isRoadDrive=trip=>trip&&trip.state==='recording'&&trip.source==='device'&&trip.recordingMode==='automatic'&&trip.activity==='Driving';
export function useLiveRoads({trip,owner,enabled}){
 const busy=useRef(false),latest=useRef(null);
// A refused publication is retried after its back-off; this wakes the hook for that.
 const [retry,setRetry]=useState(0);
 const [foreground,setForeground]=useState(()=>typeof document==='undefined'||document.visibilityState!=='hidden');
 useEffect(()=>{
  const changed=()=>setForeground(document.visibilityState!=='hidden');
  document.addEventListener('visibilitychange',changed);
  return()=>document.removeEventListener('visibilitychange',changed);
 },[]);
 const recording=isRoadDrive(trip)?trip:null;
 useEffect(()=>{latest.current=recording;});
 // Re-run when a gap closes, not on every GPS point.
 const gapIds=recording?routeGaps(recording,{live:true}).map(g=>gapKey(recording.id,g)).join('|'):'';
 useEffect(()=>{
  if(!enabled||!foreground||!owner||!gapIds||busy.current||!supabase||!recorderAvailable())return;
  busy.current=true;
  (async()=>{
   // Keep going while there is work: a gap that closed during a pass, or more gaps than
   // one pass handles, is picked up from the latest points, not left for a later change.
   for(let pass=0;pass<20;pass++){
    const current=latest.current;
    if(!current||document.visibilityState==='hidden')break;
    const done=await liveRoadWork({trip:current,lookup:(from,to)=>recorder.roadRoute(from,to),
     publish:(ref,gap,line)=>supabase.rpc('put_my_live_road',{p_ref:ref,p_gap:gap,p_line:line})});
    if(!done.length)break;
   }
  })().catch(()=>{}).finally(()=>{busy.current=false;});
 },[gapIds,enabled,foreground,owner,retry]);
 useEffect(()=>{
  if(!enabled||!foreground||!gapIds)return undefined;
  const timer=setInterval(()=>setRetry(n=>n+1),35000);
  return()=>clearInterval(timer);
 },[gapIds,enabled,foreground]);
}
