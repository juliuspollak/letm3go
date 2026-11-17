import {feedDistanceKm} from '../lib/activityCapabilities.js';
import {activityLabel} from '../lib/activityNames.js';
import {useCallback,useEffect,useState} from 'react';
import {supabase} from '../lib/supabase.js';
import {keepIfSame} from '../lib/sameData.js';
export default function FriendTrips(){
 const [feed,setFeed]=useState([]),[error,setError]=useState('');
 const refresh=useCallback(async()=>{
  if(!supabase)return;
  const a=await supabase.rpc('my_friend_trip_feed');
  if(a.error){setError('Friend activity feed is unavailable until its database migration is applied.');return;}
  setFeed(keepIfSame(a.data||[]));setError('');
 },[]);
 useEffect(()=>{
  const initial=setTimeout(()=>void refresh(),0);
  const interval=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},30000);
  const onVisible=()=>{if(document.visibilityState==='visible')void refresh();};
  document.addEventListener('visibilitychange',onVisible);
  return()=>{clearTimeout(initial);clearInterval(interval);document.removeEventListener('visibilitychange',onVisible);};
 },[refresh]);
 return <section className="social-panel"><h2>Friends' activities</h2><p className="muted small-copy">Only journeys explicitly shared with friends appear here. No GPS trails or private photos are included.</p>{feed.length?feed.map(t=><div className="status-row" key={t.owner_id+':'+t.trip_id}><div><strong>{t.display_name} · {t.title}</strong><p>{activityLabel(t.activity)} · {new Date(t.started_at).toLocaleDateString('en-AU')}{feedDistanceKm(t)!=null&&` · ${feedDistanceKm(t).toFixed(1)} km`}</p></div></div>):<p className="muted small-copy">No shared friend activities yet.</p>}

 {error&&<p role="alert" className="error">{error}</p>}</section>;
}
