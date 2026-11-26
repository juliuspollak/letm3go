import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleOff, MapPin, Search, Navigation, Pencil, Trash2 } from 'lucide-react';
import {newUUID} from '../lib/uuid.js';
import {PLACE_ICONS} from '../lib/placeIcons.js';
import PlacePicker from './PlacePicker.jsx';
import { recorderAvailable } from '../lib/recorder.js';
// How far a saved place can reach. A place bigger than this names nothing useful, and a slider that runs to two kilometres leaves almost
// no room to set a house or a gym; an older place that is bigger keeps its own size as the end of its slider.
const SOCIAL_RADIUS_MIN=15,SOCIAL_RADIUS_MAX=50,SOCIAL_RADIUS_DEFAULT=30;
const RADIUS_MIN=50,RADIUS_MAX=500,HOME_ARRIVAL_MIN=25,HOME_RECOGNITION_MIN=15,HOME_RADIUS_MAX=100;
export default function Places({places,run,busy,error,defaultKind='favourite',household=false,selfId,memberPoints=[],mapCenter,peoplePins}){
 const [editing,setEditing]=useState(null),[point,setPoint]=useState(null),[radius,setRadius]=useState(150),[radiusMax,setRadiusMax]=useState(RADIUS_MAX),[kind,setKind]=useState(defaultKind),[homeRadius,setHomeRadius]=useState(30),[query,setQuery]=useState(''),[results,setResults]=useState([]),[searching,setSearching]=useState(false),[locating,setLocating]=useState(false),[notice,setNotice]=useState(''),[confirm,setConfirm]=useState(null);
 const radiusMin=household?SOCIAL_RADIUS_MIN:kind==='home'?HOME_ARRIVAL_MIN:RADIUS_MIN;
 const radiusLimit=household?SOCIAL_RADIUS_MAX:kind==='home'?HOME_RADIUS_MAX:radiusMax;
 const legacySocialRadius=household&&radius>SOCIAL_RADIUS_MAX;
 const arrivalRadius=Math.max(radiusMin,legacySocialRadius?radius:Math.min(radius,radiusLimit));
 const recognitionRadius=Math.max(HOME_RECOGNITION_MIN,Math.min(homeRadius,HOME_RADIUS_MAX));
 const searchVersion=useRef(0);
 useEffect(()=>{
  if(!editing||query.trim().length<3){return;}
  let active=true;const version=++searchVersion.current;
  const timer=setTimeout(async()=>{setSearching(true);try{const result=await run('searchAddress',query.trim());if(active&&version===searchVersion.current)setResults(result?.results||[]);}catch{if(active)setNotice('Address suggestions unavailable. Try the map instead.');}finally{if(active)setSearching(false);}},400);
  return()=>{active=false;clearTimeout(timer);};
 },[query,editing,run]);
 async function currentLocation(){setNotice('');setLocating(true);try{const result=await run('currentPosition');if(Number.isFinite(result?.latitude)&&Number.isFinite(result?.longitude)){setPoint({latitude:result.latitude,longitude:result.longitude});setNotice('Current position selected. Check the pin and radius before saving.');}else setNotice('Could not obtain your location. Check location permission in iPhone Settings.');}catch{setNotice('Location unavailable. Check location permission in iPhone Settings.');}finally{setLocating(false);}}
 const pick=useCallback(p=>setPoint(p),[]);
 function edit(place){setEditing(place||{name:defaultKind==='home'?'Home':defaultKind==='work'?'Work':'',kind:defaultKind,...(household?{draftId:newUUID()}: {})});setPoint(place?{latitude:place.latitude,longitude:place.longitude}:null);setRadius(place?.radius??(household?SOCIAL_RADIUS_DEFAULT:150));setRadiusMax(Math.max(RADIUS_MAX,Math.ceil((place?.radius||0)/5)*5));setKind(place?.kind||defaultKind);setHomeRadius(place?.homeRecognitionRadius??30);setResults([]);setQuery('');setNotice('');}
 function closeEditor(){setEditing(null);}
 async function save(e){e.preventDefault();const form=new FormData(e.currentTarget);if(!point)return;const result=await run('savePlace',{id:editing.id,name:form.get('name').trim(),kind,...(household?{icon:form.get('icon'),draftId:editing.draftId}:{}),...point,radius:arrivalRadius,...(kind==='home'?{homeRecognitionRadius:recognitionRadius}:{}),shareWithFriends:form.get('shareWithFriends')==='on'});if(result)closeEditor();}
 const picker=<PlacePicker peoplePins={peoplePins} center={mapCenter} point={point} radius={kind==='home'?recognitionRadius:arrivalRadius} arrivalRadius={kind==='home'?arrivalRadius:undefined} onPick={pick}/>;
 return <><p className="eyebrow">{household?'SOCIAL':'PRIVATE PLACES'}</p><h2>{household?'Locations':'A name for your somewhere.'}</h2>{household&&<p className="muted">Your iPhone can pause GPS after you settle at a saved location. A Wi-Fi connection can help confirm rest sooner. New places are also available to your household if you belong to one.</p>}{!household&&<p className="muted">Saved places help recognise your arrivals. Coordinates stay on this device until you explicitly enable private cloud sync.</p>}
 {!editing?<><div className="place-list">{places.map(place=>{
  const Icon=PLACE_ICONS[place.icon]?.Icon||MapPin;
  const canEdit=!household||place.owner_id===selfId;
  return <div className="status-row" key={place.id}><Icon size={20}/><div><strong>{place.name}</strong><p>{household?(PLACE_ICONS[place.icon]?.label||'No icon'):place.kind} · {place.kind==='home'?(place.homeRecognitionRadius??30):place.radius} m radius · {household?(place.household_id?(place.shareWithFriends?'Household and friends':'Household'):(place.shareWithFriends?'Friends':'Private')):(place.shareWithFriends?'Name shown to friends':'Private')}</p></div>{canEdit&&<><button className="icon-button" disabled={busy} aria-label={`Edit ${place.name}`} onClick={()=>edit(place)}><Pencil size={17}/></button><button className="icon-button" disabled={busy} aria-label={`Remove ${place.name}`} onClick={()=>setConfirm(place)}><Trash2 size={17}/></button></>}</div>;
 })}</div><button className="primary full" disabled={busy||(!household&&!recorderAvailable())} onClick={()=>edit(null)}>{household?'Add a location':'Add a private place'}</button>{confirm&&<div className="notice"><p>Remove {confirm.name}? The saved geofence will be removed.</p><button className="secondary" onClick={()=>setConfirm(null)}>Cancel</button><button className="primary" disabled={busy} onClick={async()=>{if(await run('removePlace',confirm.id))setConfirm(null);}}>Remove place</button></div>}</>:<>{household&&picker}<div className="place-search"><input aria-label="Address search" autoComplete="off" value={query} onChange={e=>{setQuery(e.target.value);setResults([]);}} placeholder="Search for an address…"/><button type="button" className="secondary" disabled={busy||query.trim().length<3} onClick={async()=>{setSearching(true);try{const result=await run('searchAddress',query.trim());setResults(result?.results||[]);}finally{setSearching(false);}}}><Search size={17}/></button></div>
{searching&&<p className="muted small-copy" role="status">Finding addresses…</p>}
{results.length>0&&<div className="place-search-results">{results.map((result,index)=><button type="button" className="address-result" key={index} onClick={()=>{setPoint({latitude:result.latitude,longitude:result.longitude});setResults([]);setQuery(result.name);setNotice('Address selected. Check the pin and radius.');}}>{result.name}</button>)}</div>}
<button type="button" className="secondary full" disabled={busy||locating} onClick={currentLocation}><Navigation size={17}/> {locating?'Finding your location…':'Use current location'}</button>
{household&&memberPoints.length>0&&<label>Start from someone’s live location<select value="" onChange={e=>{const member=memberPoints.find(member=>member.user_id===e.target.value);if(member){pick(member.position);setNotice('Check the pin and radius before saving.');}}}><option value="">Choose a friend or household member</option>{memberPoints.map(member=><option key={member.user_id} value={member.user_id}>{member.display_name}</option>)}</select></label>}
{notice&&<p className="muted small-copy" role="status">{notice}</p>}
{!household&&picker}

{household&&<p className="muted small-copy">{peoplePins?.length
 ? 'Tap a live bubble to place the pin. Older positions show when they were last updated.'
 : 'No shared positions are available right now.'}</p>}
<div className="place-radius-control"><label htmlFor="place-radius"><span className={`ring-key${kind==='home'?' ring-key--arrival':''}`} aria-hidden="true"/>{kind==='home'?'Arrival and place-name radius':'Recognition radius'} <strong>{arrivalRadius} m</strong></label><input id="place-radius" type="range" min={radiusMin} max={radiusLimit} step={5} value={Math.min(arrivalRadius,radiusLimit)} onChange={e=>setRadius(Number(e.target.value))}/></div>
{legacySocialRadius&&<button type="button" className="text-button" onClick={()=>setRadius(SOCIAL_RADIUS_MAX)}>Reduce radius to 50 m</button>}
{kind==='home'&&<div className="place-radius-control"><label htmlFor="home-radius"><span className="ring-key" aria-hidden="true"/>Recognition radius <strong>{recognitionRadius} m</strong></label><input id="home-radius" type="range" min={HOME_RECOGNITION_MIN} max={HOME_RADIUS_MAX} step={1} value={recognitionRadius} onChange={e=>setHomeRadius(Number(e.target.value))}/></div>}
<form onSubmit={save}><label>Place name<input name="name" defaultValue={editing.name} required maxLength={100}/></label>{household&&<fieldset className="place-icon-picker"><legend>Icon</legend>
 {Object.entries({none:{label:'No icon',Icon:CircleOff},...PLACE_ICONS}).map(([value,{label,Icon}])=>
 <label key={value}><input className="sr-only" type="radio" name="icon" value={value} defaultChecked={value===(editing.icon||'none')}/><span><Icon size={20} aria-hidden="true"/>{label}</span></label>)}
</fieldset>}{!household&&<label>Type<select name="kind" value={kind} onChange={e=>{setKind(e.target.value);}}>{editing.kind==='home'&&<option value="home">Saved place</option>}<option value="work">Work · sensitive</option><option value="favourite">Favourite</option></select></label>}<label className="check-row"><input type="checkbox" name="shareWithFriends" defaultChecked={editing.shareWithFriends===true}/> {household?'Share with my friends':"Show friends when I'm here"} <span className="muted small-copy">{household?'Your accepted friends can use this location’s pin, radius, name and icon on their maps. Live location sharing still follows each person’s settings.':'Friends who can see your location are told the place name while you stay here. Coordinates are not shared.'}</span></label><button className="primary full" disabled={!point||busy}>{household?'Save location':'Save private place'}</button><button type="button" className="secondary full" onClick={closeEditor}>Cancel</button></form></>}{error&&<p role="alert" className="error">{error}</p>}</>;
}
