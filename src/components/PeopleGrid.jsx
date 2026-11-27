import {useEffect,useId,useRef,useState} from 'react';
import {flushSync} from 'react-dom';
import PersonAvatar from './PersonAvatar.jsx';
import {personTileLocation,shortAge} from '../lib/homePeople.js';
import {PLACE_ICONS} from '../lib/placeIcons.js';
import {travelDuration} from '../lib/useDriveTimes.js';
import {Bike,CarFront,Check,CircleAlert,Clock3,Footprints,Hand,House,LoaderCircle,MapPin,MapPinOff,ShieldOff,Snail,TriangleAlert} from 'lucide-react';

export default function PeopleGrid({people,photos=null,selfId=null,selfAvatar=null,label}){
 return <ul className="people-grid" aria-label={label}>{people.map(person=><li key={person.id}><PersonTile person={person} photos={photos} selfId={selfId} selfAvatar={selfAvatar}/></li>)}</ul>;
}

export function PeopleSkeleton({count=3}){
 return <ul className="people-grid people-skeleton" role="status" aria-busy="true" aria-label="Loading friends">{Array.from({length:count},(_,i)=><li key={i} aria-hidden="true"><span className="skeleton-avatar"/><span className="skeleton-line"/></li>)}</ul>;
}

const travelModes=[
 ['Driving','driveSeconds',CarFront],
 ['Walking','walkSeconds',Footprints],
 ['Cycling','cycleSeconds',Bike],
];

function snailDuration(walkSeconds){
 if(!Number.isFinite(walkSeconds)||walkSeconds<0)return '';
 const days=Math.round(walkSeconds*1000/86400);
 return days===0?'<1 day':days===1?'1 day':`${days} days`;
}

function TravelTimes({travel,destination}){
 const [selection,setSelection]=useState(0);
 const [reduced,setReduced]=useState(()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
 useEffect(()=>{
  const preference=window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const update=event=>setReduced(event.matches);
  if(!preference)return;
  if(preference.addEventListener){
   preference.addEventListener('change',update);
   return()=>preference.removeEventListener('change',update);
  }
  preference.addListener(update);
  return()=>preference.removeListener(update);
 },[]);
 useEffect(()=>{
  if(reduced||travel.length<2)return;
  const timer=setTimeout(()=>setSelection(selection+1),3000);
  return()=>clearTimeout(timer);
 },[reduced,selection,travel.length]);
 const index=selection%travel.length;
 const {label,time}=travel[index];
 const content=travel.map(({label,time,Icon},i)=><span key={label} data-active={index===i} aria-hidden="true">
  <Icon size={16}/>{time.replace(/ h/g,'h').replace(/ min/g,'m').replace(/ days?/g,'d')}
 </span>);
 const description=`${label}: ${time} to ${destination}`;
 return travel.length>1
  ?<button type="button" className="person-travel" aria-label={`${description}. Next travel estimate`} onClick={()=>setSelection(selection+1)}>{content}</button>
  :<span className="person-travel" role="img" aria-label={description}>{content}</span>;
}

const refreshFeedback={
 'Refreshing…':{tone:'refreshing'},
 'New location':{tone:'new',Icon:Check,message:'A newer location was received.'},
 'No new location':{tone:'unchanged',Icon:Clock3,message:'No new location received. Showing the last known location.'},
 'Request failed':{tone:'failed',Icon:CircleAlert,message:'The location refresh request could not be sent.'},
 'Couldn’t check':{tone:'unchecked',Icon:TriangleAlert,message:'Could not verify whether a newer location was received.'},
};

function Wave({poke,received,name,onPoke}){
 const {state,message}=poke||{};
 const busy=state==='sending'||state==='sent';
 const label=state==='sending'?`Sending wave to ${name}`:state==='sent'?`Wave sent to ${name}`:state==='failed'?`Wave to ${name} failed${message?`. ${message}`:''}. Try again`:`Wave to ${name}`;
 const incoming=received?`${name} waved at you`:'';
 const Icon=state==='sent'?Check:state==='failed'?CircleAlert:state==='sending'?LoaderCircle:Hand;
 return <>
  {onPoke
   ?<button type="button" className="person-edge person-wave" data-state={state} aria-disabled={busy||undefined} aria-label={[label,incoming].filter(Boolean).join('. ')} onClick={busy?undefined:onPoke}>
    <span className="person-edge-icon" data-received={received||undefined}><Icon size={15} aria-hidden="true"/></span>
   </button>
   :received&&<span className="person-edge person-wave" aria-hidden="true"><span className="person-edge-icon" data-received><Hand size={15}/></span></span>}
  <span className="sr-only" role="status">{[state?label:'',incoming].filter(Boolean).join('. ')}</span>
 </>;
}

export function PersonTile({person,photos,selfId,selfAvatar}){
 const name=person.name||'Person';
 const shown=person.self?'You':name;
 const location=person.location;
 const status=location&&!(person.self&&location.state==='stale')?personTileLocation(location):person.status;
 const atHome=status?.tone==='home';
 const lastKnown=(location?.state||person.state)==='stale'||status?.tone==='stale'||status?.lastKnown===true;
 const current=!lastKnown&&(location?.state==='live'||status?.tone==='live'||atHome);
 const savedPlace=location?.savedPlace;
 const savedPlaceLabel=savedPlace?`${lastKnown?'Last at':'At'} ${savedPlace.name}`:null;
 const nearbyLabel=current&&!atHome&&!savedPlace&&!location?.placeName&&person.nearbyPlace?`Near ${person.nearbyPlace}`:null;
 const SavedPlaceIcon=PLACE_ICONS[savedPlace?.icon]?.Icon;
 const age=lastKnown?shortAge(location?.ageSeconds):'';
 const travel=!atHome&&(current||lastKnown)?[
  ...travelModes.map(([label,key,Icon])=>({label,Icon,time:travelDuration(person[key])})),
  {label:'Snail',Icon:Snail,time:snailDuration(person.walkSeconds)},
 ].filter(mode=>mode.time):[];
 const destination=lastKnown?'last known location':'current location';
 const travelDescription=travel.length?`Estimated travel to ${destination}. ${travel.map(({label,time})=>`${label}: ${time}`).join(', ')}`:'';
 const activity=current&&location?.activity
  ?location.activity
  :location?.lastKnownActivity?`Last activity: ${location.lastKnownActivity}`:null;
 const locationDescription=[atHome?(lastKnown?'Last verified at home':'At home'):lastKnown?'Last known location':null,
  status?.text==='At home'?null:status?.text,activity&&!status?.text?.includes(activity)?activity:null,nearbyLabel,person.distance].filter(Boolean).join('. ');
 const LocationIcon=atHome?House:status?.tone==='off'?ShieldOff:location?.state==='waiting'||person.self&&status?.tone==='none'?Clock3:status?.tone==='issue'?TriangleAlert:current||lastKnown?MapPin:MapPinOff;
 const refresh=refreshFeedback[person.refreshLabel];
 const RefreshIcon=refresh?.Icon;
 const refreshMessage=refresh?.tone==='unchanged'&&!current&&!lastKnown
  ?'No new location received. There is no previous location to show.'
  :refresh?.message;
 const dialog=useRef(null);
 const opener=useRef(null);
 const titleId=useId();
 const [panel,setPanel]=useState('details');

 function openPanel(next,event){
  opener.current=event.currentTarget;
  // Native dialog focus runs synchronously and needs the selected panel's title.
  flushSync(()=>setPanel(next));
  if(dialog.current.showModal)dialog.current.showModal();
  else{
   dialog.current.setAttribute('open','');
   dialog.current.querySelector('button').focus();
  }
 }
 function closePanel(){
  if(dialog.current.close)dialog.current.close();
  else dialog.current.removeAttribute('open');
  opener.current?.focus();
 }

 const photoLabel=[person.actionLabel||`Show ${shown} on the map.`,locationDescription,travelDescription].filter(Boolean).join(' ');
 const Photo=person.onSelect?'button':'div';
 return <div className="person-tile">
  <div className="person-tile-avatar" data-location={current?'current':lastKnown?'last-known':'unavailable'} data-refresh={refresh?.tone}>
   <Photo className="person-photo" {...(person.onSelect?{type:'button','aria-label':photoLabel,onClick:person.onSelect}:{})}>
    <PersonAvatar name={name} userId={person.userId} selfId={selfId} photos={photos} selfAvatar={selfAvatar} size="lg"/>
   </Photo>
   <svg className="person-ring" viewBox="0 0 100 100" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
    <circle className="person-ring-track" cx="50" cy="50" r="49.25"/>
    {refresh?.tone==='refreshing'&&<circle className="person-refresh-arc" cx="50" cy="50" r="49.25" pathLength="100" strokeDasharray="29 71"/>}
   </svg>
   {age&&<span className="person-freshness" aria-hidden="true">{age}</span>}
   {travel.length>0?<TravelTimes travel={travel} destination={destination}/>:!savedPlace&&<span className="person-location-icon" role="img" aria-label={locationDescription||'Location unavailable'}><LocationIcon size={18} aria-hidden="true"/></span>}
   {RefreshIcon&&<button type="button" className="person-edge person-refresh" aria-haspopup="dialog" aria-label={`${shown}: ${person.refreshLabel}. Show refresh details`} onClick={event=>openPanel('refresh',event)}>
    <span className="person-edge-icon"><RefreshIcon size={12} aria-hidden="true"/></span>
   </button>}
   <Wave poke={person.poke} received={person.receivedPoke} name={shown} onPoke={person.onPoke}/>
  </div>
  <button type="button" className="person-tile-name" aria-haspopup="dialog" aria-label={`Location details for ${shown}`} onClick={event=>openPanel('details',event)}>
   {SavedPlaceIcon&&<SavedPlaceIcon className="person-name-place-icon" size={13} aria-hidden="true"/>}
   <span>{shown}</span>
  </button>
  {(savedPlaceLabel||nearbyLabel)&&<span className={savedPlaceLabel?"person-saved-place":"person-saved-place person-nearby-place"} title={savedPlaceLabel||nearbyLabel}>
   {savedPlaceLabel||nearbyLabel}
  </span>}
  <span className="sr-only" role="status">{refresh?`${shown}: ${person.refreshLabel}`:''}</span>
  <dialog ref={dialog} className="person-details" role="dialog" aria-labelledby={titleId} onKeyDown={event=>{
   if(event.key==='Escape'){event.preventDefault();closePanel();}
  }}>
   <h2 id={titleId}>{panel==='refresh'?`${shown}’s location refresh`:shown}</h2>
   {panel==='refresh'?<p>{refreshMessage||'The refresh result has expired.'}</p>:<>
    {person.role&&<p>{person.role}</p>}
    <p>{locationDescription}</p>
    {person.poke?.state==='failed'&&<p>{person.poke.message||'The wave could not be sent. Try again.'}</p>}
    {travel.length>0&&<>
     <p>Estimated travel to {destination}</p>
     <ul>{travel.map(({label,time})=><li key={label}>{label}: {time}</li>)}</ul>
    </>}
   </>}
   <button type="button" className="secondary" onClick={closePanel}>Close</button>
  </dialog>
 </div>;
}
