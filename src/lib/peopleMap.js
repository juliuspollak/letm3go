// What the people map says about each person, and which people the camera keeps
// in view. Pure functions, so the rules are tested without a map.
import {distanceMetres,formatAge,validPoint} from './householdLocation.js';

// "2h 15m", "42m". Durations come only from a confirmed arrival (see
// docs/live-household-map.md); nothing here estimates one.
export function formatDuration(seconds){
 if(!Number.isFinite(seconds)||seconds<0)return '';
 const minutes=Math.floor(seconds/60);
 if(minutes<60)return `${Math.max(1,minutes)}m`;
 const hours=Math.floor(minutes/60),rest=minutes%60;
 if(hours<24)return rest?`${hours}h ${rest}m`:`${hours}h`;
 const days=Math.floor(hours/24),hoursLeft=hours%24;
 return hoursLeft?`${days}d ${hoursLeft}h`:`${days}d`;
}

// Seconds since the confirmed arrival, measured on the server clock. Only for a
// live position: a stale one says when it was last updated instead.
export function secondsAtPlace(row){
 if(row?.state!=='live'||!row.arrived_at)return null;
 const arrived=Date.parse(row.arrived_at),now=Date.parse(row.server_now);
 if(!Number.isFinite(arrived)||!Number.isFinite(now)||arrived>now)return null;
 return Math.round((now-arrived)/1000);
}

// A name for where someone is, from the viewer's own saved places only (the
// viewer's labels, never the other person's private ones). Home is decided
// separately, with hysteresis, by atHome.
export function savedPlaceName(point,places=[]){
 if(!point||!validPoint(point.latitude,point.longitude))return null;
 const uncertainty=Math.min(100,Math.max(0,Number(point.accuracy)||0))/2;
 let best=null;
 for(const place of places){
  if(!place||place.kind==='home'||!validPoint(place.latitude,place.longitude)||!place.name?.trim())continue;
  const radius=Math.max(50,Math.min(2000,Number(place.radius)||150));
  const distance=distanceMetres(place,point);
  if(distance+uncertainty<=radius&&(!best||distance<best.distance))best={name:place.name.trim().slice(0,30),distance};
 }
 return best?.name||null;
}

// Movement status, for the map's person model and later activity artwork. Only
// what is actually known: the coarse status a member already shares (from motion
// and recording, never GPS speed alone), Home, or a confirmed stay. Anything else
// is unknown.
export const ACTIVITIES=['driving','walking','cycling','running','stationary','home','unknown'];
const SHARED_ACTIVITY={Driving:'driving',Walking:'walking',Cycling:'cycling',Running:'running'};
export function personActivity({state,home=false,seconds=null,shared=null}){
 if(state!=='live')return 'unknown';
 if(SHARED_ACTIVITY[shared])return SHARED_ACTIVITY[shared];
 if(home)return 'home';
 if(seconds!=null)return 'stationary';
 return 'unknown';
}

// Words for one person. `text` is the full sentence (callouts, accessibility),
// `short` fits the pill above the avatar, `kind` picks its icon.
export function personLabel({state,ageSeconds=null,home=false,place=null,seconds=null}){
 const duration=seconds!=null?formatDuration(seconds):'';
 if(state==='stale'){
  const age=formatAge(ageSeconds);
  return {text:`Last updated ${age}`,short:age,kind:'stale'};
 }
 if(state!=='live')return {text:'Location unavailable',short:null,kind:'none'};
 if(home)return {text:duration?`At Home · ${duration}`:'At Home',short:duration?`Home · ${duration}`:'Home',kind:'home'};
 if(place&&duration)return {text:`At ${place} · ${duration}`,short:`${place} · ${duration}`,kind:'place'};
 if(place)return {text:`At ${place}`,short:place,kind:'place'};
 if(duration)return {text:`At a place · ${duration}`,short:`At a place · ${duration}`,kind:'place'};
 return {text:ageSeconds!=null&&ageSeconds>=60?`Updated ${formatAge(ageSeconds)}`:'Updated just now',short:null,kind:'live'};
}

// Who the camera keeps in view when it shows everyone. Live people always. A
// stale position only when it is near someone live, so one phone that stopped
// reporting on another continent does not shrink everyone else to dots; it stays
// on the map with its own edge avatar and "Show on map". With nobody live, every
// last known position is fitted.
export const STALE_FIT_METRES=25000;
export function cameraFit(people){
 const live=people.filter(p=>p.state==='live');
 return Object.fromEntries(people.map(p=>[p.id,p.state==='live'||!live.length||live.some(l=>distanceMetres(l,p)<=STALE_FIT_METRES)]));
}
