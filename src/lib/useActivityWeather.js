import {useEffect,useRef} from 'react';
import {recorder,recorderAvailable} from './recorder.js';
import {weatherOf} from './weather.js';

// Fetches the weather for recent finished activities that have none, one at a time, once
// per app launch each. A failure (offline, WeatherKit not enabled) just leaves them without.
const MAX_PER_LAUNCH=40;
export function useActivityWeather({trips,enabled,fetch=id=>recorder.fetchWeather(id)}){
 const tried=useRef(new Set()),running=useRef(false),latest=useRef(fetch);
 useEffect(()=>{latest.current=fetch;});
 useEffect(()=>{
  if(!enabled||!recorderAvailable()||running.current)return;
  const wanted=(trips||[]).filter(t=>t.endedAt!=null&&t.state!=='recording'&&['device','watch'].includes(t.source)&&t.activity!=='Gym'&&t.points?.length>0&&!weatherOf(t)&&!tried.current.has(t.id)).sort((a,b)=>b.startedAt-a.startedAt).slice(0,MAX_PER_LAUNCH).map(t=>t.id);
  if(!wanted.length)return;
  running.current=true;
  (async()=>{
   for(const id of wanted){
    tried.current.add(id);
    try{await latest.current(id);}catch{/* No weather for this one. */}
   }
   running.current=false;
  })();
 },[enabled,trips]);
}
