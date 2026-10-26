import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {supabase} from '../lib/supabase.js';

// Household shares only activities assigned to a vehicle deliberately linked to this household.
// No routes, point locations or photographs leave the device through this feature.
export default function HouseholdTrips({owner,activities=[]}){
 const key='letm3go-household-trip-share:'+owner;
 const [enabled,setEnabled]=useState(()=>localStorage.getItem(key)==='true');
 const [vehicles,setVehicles]=useState([]),[feed,setFeed]=useState([]),[published,setPublished]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const active=useRef(false);
 const refresh=useCallback(async()=>{
  if(!supabase)return;
  try{
   const results=await Promise.all([supabase.rpc('my_household_vehicles'),supabase.rpc('my_household_vehicle_trip_feed'),supabase.rpc('my_published_household_trip_ids')]);
   if(results.some(x=>x.error))throw Error('Household journeys are unavailable until the database migration is applied.');
   setVehicles(results[0].data||[]);setFeed(results[1].data||[]);setPublished((results[2].data||[]).map(x=>x.trip_id));setError('');
   return {cars:results[0].data||[],ids:new Set((results[2].data||[]).map(x=>x.trip_id))};
  }catch(e){setError(e.message||'Could not load household journeys.');return null;}
 },[]);
 const eligible=useMemo(()=>activities.filter(t=>!t.readOnly&&!t.isGroupedJourney&&t.endedAt&&Number.isFinite(t.startedAt)&&
  (t.activity==='Driving'||t.activity==='Unknown')&&
  vehicles.some(v=>v.local_vehicle_id&&String(v.local_vehicle_id)===String(t.vehicleID||''))),[activities,vehicles]);
 const sync=useCallback(async(initial)=>{
  if(!supabase||active.current)return;
  active.current=true;setBusy(true);
  try{
   const current=initial||await refresh();if(!current)return;
   const matches=activities.filter(t=>!t.readOnly&&!t.isGroupedJourney&&t.endedAt&&Number.isFinite(t.startedAt)&&
    (t.activity==='Driving'||t.activity==='Unknown')).map(t=>({t,car:current.cars.find(v=>v.local_vehicle_id&&String(v.local_vehicle_id)===String(t.vehicleID||''))})).filter(x=>x.car&&!current.ids.has(String(x.t.id)));
   for(const {t,car} of matches.slice(0,30)){
    const {error:e}=await supabase.rpc('publish_household_vehicle_trip',{p_vehicle:car.id,p_local_vehicle:car.local_vehicle_id,
     p_trip:String(t.id),p_title:t.title||'Vehicle journey',p_started:new Date(t.startedAt*1000).toISOString(),
     p_km:Math.max(0,Number(t.distanceMeters||0)/1000)});
    if(e)throw e;
   }
   if(matches.length)await refresh();
  }catch(e){setError(e.message||'Could not synchronise household journeys.');}finally{active.current=false;setBusy(false);}
 },[activities,refresh]);
 useEffect(()=>{const timer=setTimeout(()=>void refresh(),0);return()=>clearTimeout(timer);},[refresh]);
 useEffect(()=>{
  if(!enabled)return;
  const initial=setTimeout(()=>{if(document.visibilityState==='visible')void sync();},1500);
  const interval=setInterval(()=>{if(document.visibilityState==='visible')void sync();},60000);
  const visible=()=>{if(document.visibilityState==='visible')void sync();};
  document.addEventListener('visibilitychange',visible);
  return()=>{clearTimeout(initial);clearInterval(interval);document.removeEventListener('visibilitychange',visible);};
 },[enabled,sync]);
 async function toggle(){
  if(busy)return;
  setError('');
  if(!enabled){
   const current=await refresh();if(!current)return;
   if(!current.cars.some(v=>v.local_vehicle_id)){setError('Link your vehicle in the Household section first.');return;}
   localStorage.setItem(key,'true');setEnabled(true);void sync(current);
  }else{
   setBusy(true);
   try{
    const result=await supabase.rpc('my_published_household_trip_ids');if(result.error)throw result.error;
    for(const t of result.data||[]){const r=await supabase.rpc('unpublish_household_vehicle_trip',{p_trip:t.trip_id});if(r.error)throw r.error;}
    localStorage.removeItem(key);setEnabled(false);await refresh();
   }catch(e){setError(e.message||'Failed to stop household trip sharing.');}
   finally{setBusy(false);}
  }
 }
 return <section className="social-panel">
  <h2>Shared vehicle journeys</h2>
  <p className="muted small-copy">Household members see journeys for cars you have explicitly linked. Your personal walks, hikes and photos remain private.</p>
  <button type="button" className="secondary full" disabled={busy} aria-pressed={enabled} onClick={()=>void toggle()}>{busy?'Updating…':enabled?'Stop sharing my vehicle trips':'Share my linked vehicle trips'}</button>
  <p className="muted small-copy">{enabled?'Sharing is on for linked cars. New journeys synchronise while this app is open.':'Off by default. Link a car, then opt in to share its existing and future journeys.'}</p>
  <p className="muted small-copy">{eligible.length} eligible local vehicle {eligible.length===1?'journey':'journeys'} · {published.length} published by you</p>
  {feed.length?feed.map(t=><div className="status-row" key={t.owner_id+':'+t.trip_id}><div><strong>{t.vehicle_name} · {t.title}</strong><p>{t.driver_name} · {new Date(t.started_at).toLocaleDateString('en-AU')} · {Number(t.distance_km).toFixed(1)} km</p></div></div>):<p className="muted small-copy">No household vehicle journeys shared yet.</p>}
  {error&&<p className="error" role="alert">{error}</p>}
 </section>;
}
