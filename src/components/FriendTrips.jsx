import {activityLabel} from '../lib/activityNames.js';
import {useCallback,useEffect,useState} from 'react';
import {supabase} from '../lib/supabase.js';
export default function FriendTrips({activities=[]}){
 const [feed,setFeed]=useState([]),[published,setPublished]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const refresh=useCallback(async()=>{
  if(!supabase)return;
  const [a,b]=await Promise.all([supabase.rpc('my_friend_trip_feed'),supabase.rpc('my_published_friend_trip_ids')]);
  if(a.error||b.error){setError('Friend activity feed is unavailable until its database migration is applied.');return;}
  setFeed(a.data||[]);setPublished((b.data||[]).map(x=>x.trip_id));setError('');
 },[]);
 useEffect(()=>{
  const initial=setTimeout(()=>void refresh(),0);
  const interval=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},30000);
  const onVisible=()=>{if(document.visibilityState==='visible')void refresh();};
  document.addEventListener('visibilitychange',onVisible);
  return()=>{clearTimeout(initial);clearInterval(interval);document.removeEventListener('visibilitychange',onVisible);};
 },[refresh]);
 async function share(t){
  setBusy(true);setError('');
  try{
   const already=published.includes(String(t.id));
   const params=already?{p_id:String(t.id)}:{p_id:String(t.id),p_title:t.title||t.activity||'Activity',p_activity:t.activity||'Other',p_started_at:new Date(t.startedAt*1000).toISOString(),p_distance_km:Math.max(0,(t.distanceMeters||0)/1000)};
   const {error:e}=await supabase.rpc(already?'unpublish_friend_trip':'publish_friend_trip',params);
   if(e)throw e;await refresh();
  }catch(e){setError(e.message||'Could not change sharing.');}finally{setBusy(false);}
 }
 return <section className="social-panel"><h2>Friends' activities</h2><p className="muted small-copy">Only journeys explicitly shared with friends appear here. No GPS trails or private photos are included.</p>{feed.length?feed.map(t=><div className="status-row" key={t.owner_id+':'+t.trip_id}><div><strong>{t.display_name} · {t.title}</strong><p>{activityLabel(t.activity)} · {new Date(t.started_at).toLocaleDateString('en-AU')} · {Number(t.distance_km||0).toFixed(1)} km</p></div></div>):<p className="muted small-copy">No shared friend activities yet.</p>}
 <details><summary>Share one of my activities</summary>{activities.filter(t=>!t.readOnly&&t.startedAt&&t.endedAt).slice(0,100).map(t=><div className="status-row" key={t.id}><div><strong>{t.title}</strong><p>{new Date(t.startedAt*1000).toLocaleDateString('en-AU')}</p></div><button className="secondary" type="button" disabled={busy} onClick={()=>void share(t)}>{published.includes(String(t.id))?'Stop sharing':'Share'}</button></div>)}</details>
 {error&&<p role="alert" className="error">{error}</p>}</section>;
}
