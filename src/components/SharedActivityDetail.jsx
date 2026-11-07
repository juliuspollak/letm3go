import {useMemo} from 'react';
import {useSharedActivityDetail} from '../lib/useSharedActivityDetail.js';
import ActivityDetailScreen from './ActivityDetailScreen.jsx';
import {activityPresentation} from '../lib/activityPresentation.js';
import {Capacitor} from '@capacitor/core';
import JourneyMap from './JourneyMap.jsx';
import {publicJourneyMap} from '../lib/publicJourneyMap.js';

// One detail presentation: on iOS it is the same native ActivityDetailScreen
// used for your recordings. Browser-only links use the existing map component.
export default function SharedActivityDetail({activityID=null,token=null,ownerName='Friend',ownerID,unit='km',onBack}){
 const {trip,loading,error}=useSharedActivityDetail(activityID,token,ownerName);
 const mapped=useMemo(()=>trip?publicJourneyMap({points:trip.points,photos:trip.photos.map(p=>({id:p.id,caption:p.caption,latitude:p.point?.[0],longitude:p.point?.[1]}))}):null,[trip]);
 if(error)return <div className="notice" role="alert"><p>{error}</p><button type="button" className="secondary" onClick={onBack}>Back</button></div>;
 if(loading||!trip)return <p role="status">Loading shared activity…</p>;
 if(Capacitor.getPlatform()==='ios'){
  if(!ownerID)return <div className="notice"><p>Sign in to view this activity.</p></div>;
  return <ActivityDetailScreen key={trip.id} ownerID={ownerID} trip={trip} journeys={[]} places={[]} vehicles={[]} onBack={onBack} sharedReadOnly/>;
 }
 // Public browser links reuse the same stored route and map renderer.
 const detail=activityPresentation(trip,{ownerID:ownerID||'',unit});
 return <main className="public-journey"><button className="secondary" type="button" onClick={onBack}>Back</button>
  <h1>{detail.header.title}</h1><p>{detail.header.subtitle}</p>
  <div className="shared-journey-facts">{detail.summary.map(item=><p key={item.id}><strong>{item.label}:</strong> {item.value}</p>)}</div>
  {mapped?.routeSegments?.some(segment=>segment.length>1)&&<JourneyMap journeys={[mapped]} large/>}
  {trip.description&&<p>{trip.description}</p>}
 </main>;
}
