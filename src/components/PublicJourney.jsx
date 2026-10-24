import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import JourneyMap from './JourneyMap.jsx';
function SharedPhoto({token,photo}){
 const [url,setURL]=useState(null),[error,setError]=useState(false);
 useEffect(()=>{let alive=true;supabase.functions.invoke(`journeys?token=${encodeURIComponent(token)}&photo=${encodeURIComponent(photo.id)}`,{method:'GET'}).then(({data,error})=>{if(alive){if(error||!data?.url)setError(true);else setURL(data.url);}}).catch(()=>{if(alive)setError(true);});return()=>{alive=false;};},[token,photo.id]);
 return <figure>{url?<img src={url} alt={photo.caption||'Shared journey photograph'}/>:<p>{error?'Photo unavailable':'Loading photo…'}</p>}<figcaption>{photo.caption}</figcaption></figure>;
}
export default function PublicJourney({token}){
 const [journey,setJourney]=useState(null),[error,setError]=useState('');
 useEffect(()=>{let alive=true;async function read(){try{if(!supabase||!/^[a-f0-9-]{36}$/i.test(token))throw new Error('Journey unavailable');const {data,error}=await supabase.functions.invoke(`journeys?token=${encodeURIComponent(token)}`,{method:'GET'});if(error||!data?.snapshot)throw new Error('Journey unavailable');if(alive)setJourney(data.snapshot);}catch{if(alive)setError('This shared journey is unavailable or has been revoked.');}}void read();return()=>{alive=false;};},[token]);
 const mapped=journey?{route:journey.points.map(p=>[p.latitude,p.longitude]),routeSegments:journey.points.reduce((segments,p)=>{(segments[p.segment]??=[]).push([p.latitude,p.longitude]);return segments;},[]).filter(Boolean),photos:[]}:null;
 return <main className="public-journey"><p className="eyebrow">LETM3GO · SHARED JOURNEY</p>{error?<h1>{error}</h1>:journey?<><h1>{journey.title}</h1><p>{journey.activity}</p>{mapped.route.length>0&&<JourneyMap journeys={[mapped]} large/>}<p>{journey.description}</p><div className="shared-photo-gallery">{(journey.photos||[]).map(photo=><SharedPhoto key={photo.id} token={token} photo={photo}/>)}</div><p className="muted small-copy">This is the owner’s shared projection. Sensitive route sections may be hidden.</p></>:<p role="status">Loading shared journey…</p>}</main>;
}
