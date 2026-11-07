import {useEffect,useMemo,useState} from 'react';
import {useSharedActivityDetail} from '../lib/useSharedActivityDetail.js';
import ActivityDetailScreen from './ActivityDetailScreen.jsx';
import {activityPresentation} from '../lib/activityPresentation.js';
import {Capacitor} from '@capacitor/core';
import {supabase} from '../lib/supabase.js';
import JourneyMap from './JourneyMap.jsx';
import {publicJourneyMap} from '../lib/publicJourneyMap.js';

// A public browser link still uses the same route projection. Media is signed
// per photo instead of exposing private object-storage paths.
function BrowserSharedPhoto({token,photo}){
 const [url,setURL]=useState(null);
 useEffect(()=>{
  let active=true;
  supabase.functions.invoke('journeys?token='+encodeURIComponent(token)+'&photo='+encodeURIComponent(photo.id),{method:'GET'})
   .then(({data,error})=>{if(active&&!error&&data?.url)setURL(data.url);}).catch(()=>{});
  return()=>{active=false;};
 },[token,photo.id]);
 return <figure>{url?<img src={url} alt={photo.caption||'Shared photograph'}/>:<p>Photo unavailable</p>}<figcaption>{photo.caption}</figcaption></figure>;
}

// One detail presentation: on iOS it is the same native ActivityDetailScreen
// used for your recordings. Browser-only links use the existing map component.
export default function SharedActivityDetail({activityID=null,token=null,ownerName='Friend',ownerID,unit='km',onBack}){
 const {trip,loading,error}=useSharedActivityDetail(activityID,token,ownerName);
 const mapped=useMemo(()=>trip?publicJourneyMap({points:trip.points,photos:trip.photos.map(p=>({id:p.id,caption:p.caption,latitude:p.point?.[0],longitude:p.point?.[1]}))}):null,[trip]);
 if(error)return <div className="notice" role="alert"><p>{error}</p><button type="button" className="secondary" onClick={onBack}>Back</button></div>;
 if(loading||!trip)return <p role="status">Loading shared activity…</p>;
 if(Capacitor.getPlatform()==='ios'&&ownerID){
  return <ActivityDetailScreen key={trip.id} ownerID={ownerID} trip={trip} journeys={[]} places={[]} vehicles={[]} onBack={onBack} sharedReadOnly/>;
 }
 // Public browser links reuse the same stored route and map renderer.
 const detail=activityPresentation(trip,{ownerID:ownerID||'',unit});
 return <main className="public-journey"><button className="secondary" type="button" onClick={onBack}>Back</button>
  <h1>{detail.header.title}</h1><p>{detail.header.subtitle}</p>
  <div className="shared-journey-facts">{detail.summary.map(item=><p key={item.id}><strong>{item.label}:</strong> {item.value}</p>)}</div>
  {mapped?.routeSegments?.some(segment=>segment.length>1)&&<JourneyMap journeys={[mapped]} large/>}
  {trip.description&&<p>{trip.description}</p>}
  {token&&trip.photos.length>0&&<div className="shared-photo-gallery">{trip.photos.map(photo=><BrowserSharedPhoto key={photo.id} token={token} photo={photo}/>)}</div>}
 </main>;
}
