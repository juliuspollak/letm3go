import {useEffect,useRef} from 'react';
import {supabase} from './supabase.js';
import {recorder,recorderAvailable} from './recorder.js';
import {liveRoadWork} from './liveRoads.js';
import {routeGaps,gapKey} from './gapReconstruction.js';

// While my own drive is being recorded, rebuild its closed GPS gaps as roads (once
// each) and publish them to my live trail, so people watching see the road section
// as an estimate rather than a hole. Runs only with the app open: a closed app
// shows the gap, and the finished drive gets its road from the normal pass.
export function useLiveRoads({trips,owner,enabled}){
 const busy=useRef(false);
 const recording=(trips||[]).find(t=>t.state==='recording'&&t.recordingMode==='automatic'&&t.activity==='Driving');
 // Re-run when a gap closes, not on every GPS point.
 const gapIds=recording?routeGaps(recording,{live:true}).map(g=>gapKey(recording.id,g)).join('|'):'';
 useEffect(()=>{
  if(!enabled||!owner||!recording||!gapIds||busy.current||!supabase||!recorderAvailable())return;
  busy.current=true;
  liveRoadWork({trip:recording,lookup:(from,to)=>recorder.roadRoute(from,to),
   publish:(ref,gap,line)=>supabase.rpc('put_my_live_road',{p_ref:ref,p_gap:gap,p_line:line})})
   .catch(()=>{}).finally(()=>{busy.current=false;});
 },[gapIds,enabled,owner]); // eslint-disable-line react-hooks/exhaustive-deps
}
