import {useEffect,useRef} from 'react';
import {useAuth} from '../lib/AuthContext.jsx';
import {recorder,recorderAvailable} from '../lib/recorder.js';
import {fetchWatchSegments} from '../lib/mtbApi.js';
import {buildWatchSegments} from '../lib/watchSegments.js';
import {watchSegmentRefresh} from '../lib/segmentEvents.js';

// Definitions/PRs are transferred before riding, not queried for every Watch fix.
export default function WatchSegmentSync({state}){
 const auth=useAuth(),latest=useRef(null),running=useRef(false),sequence=useRef(0),again=useRef(false);
 useEffect(()=>{latest.current={state,auth};},[state,auth]);
 useEffect(()=>{
  if(!recorderAvailable())return;
  let alive=true;
  const sync=async()=>{
   if(!alive||!navigator.onLine||document.visibilityState==='hidden')return;
   if(running.current){again.current=true;return;}
   const {state:held,auth:user}=latest.current,owner=user.session?.user?.id;
   if(user.status!=='authenticated'||!owner||held?.ownerID?.toLowerCase()!==owner.toLowerCase())return;
   running.current=true;const request=++sequence.current;
   const valid=()=>alive&&request===sequence.current&&latest.current.auth.session?.user?.id===owner&&latest.current.state?.ownerID?.toLowerCase()===owner.toLowerCase()&&latest.current.state?.historyToken===held.historyToken;
   try{
    // Last actual fix, including the newest ride, gives a useful cache even when
    // Core Location has no fresh fix yet. Never invent the person's position.
    const points=[held.automaticTrip,held.active,...(held.trips||[])].filter(Boolean).flatMap(t=>t.points?.length?[t.points.at(-1)]:[]);
    const point=points.filter(p=>Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)).sort((a,b)=>b.timestamp-a.timestamp)[0];
    const pad=0.18,lon=point?pad/Math.max(0.2,Math.cos(point.latitude*Math.PI/180)):pad;
    const publicSegments=point?await fetchWatchSegments({minLat:point.latitude-pad,maxLat:point.latitude+pad,minLon:point.longitude-lon,maxLon:point.longitude+lon}):[];
    if(!valid())return;
    const catalogue=await buildWatchSegments({ownerID:owner,trips:held.trips,publicSegments,yieldWork:()=>new Promise(resolve=>setTimeout(resolve,0))});
    if(valid())await recorder.setWatchSegments(JSON.stringify(catalogue));
   }catch{/* Retain the last owner-scoped offline catalogue; reconnect retries. */}
   finally{running.current=false;if(again.current&&alive){again.current=false;void sync();}}
  };
  const timer=setTimeout(()=>void sync(),8000),stop=watchSegmentRefresh(()=>void sync(),{interval:300000});
  return()=>{alive=false;clearTimeout(timer);stop();};
 },[]);
 // A finished ride, segment edit or newly bound owner refreshes the cached PR.
 useEffect(()=>{if(state?.historyToken&&auth.status==='authenticated')window.dispatchEvent(new Event('letm3go:segments-changed'));},[state?.historyToken,state?.ownerID,auth.status]);
 return null;
}
