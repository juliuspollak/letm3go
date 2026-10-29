import PersonAvatar from './PersonAvatar.jsx';
import {Clock3,MapPin,MapPinOff} from 'lucide-react';

// A small badge on the avatar summarises location sharing; the text below says it
// in words. Green only means a recent position was actually received.
const LOCATION_ICONS={live:MapPin,waiting:MapPin,unavailable:MapPin,stale:Clock3,off:MapPinOff};

// Every person in Social uses this bubble, so a household organiser, a member,
// a friend and "You" all resolve their avatar through the same id-based lookup.
export default function PersonBubble({name='Person',src=null,userId=null,selfId=null,photos=null,selfAvatar=null,label,status,action,location=null,onLocate=null}){
 const displayName=name||'Person';
 const Icon=location?LOCATION_ICONS[location.state]:null;
 return <div className="person-bubble"><span className="person-bubble-avatar"><PersonAvatar name={displayName} src={src} userId={userId} selfId={selfId} photos={photos} selfAvatar={selfAvatar} size="lg"/>{Icon&&<span className={`person-location-badge person-location-badge--${location.state}`} title={location.text} aria-hidden="true"><Icon size={11} strokeWidth={2.6}/></span>}</span><strong title={label||displayName}>{label||displayName}</strong>{status&&<small>{status}</small>}{location?.text&&<small className={`person-location-text person-location-text--${location.state}`}>{location.text}</small>}{onLocate&&<button type="button" className="person-bubble-locate" onClick={onLocate} aria-label={`Show ${displayName} on the map`}>Show on map</button>}{action&&<div className="person-bubble-action">{action}</div>}</div>;
}
