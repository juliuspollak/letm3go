// The community segment library (20261126000000_community_segments.sql): what the
// Activities → Segments view, a segment's details and the Map's Segments layer
// read and change. Permissions are enforced by the database; the app only shows
// the actions the server says this person may take (`can_edit`).
import {useEffect,useRef,useState} from 'react';
import {supabase} from './supabase.js';
import {simplifyGeometry} from './mtb.js';

export const SEGMENT_SCOPES=[['all','All'],['nearby','Nearby'],['mine','Mine']];
export const SEGMENT_PAGE=40;
// Wider than this the Map's Segments layer asks the person to zoom in (the server
// refuses a larger area too), so opening the map never downloads the world.
export const MAP_SEGMENT_MAX_SPAN=5;

const need=client=>{if(!client)throw new Error('Sign in to see community segments.');return client;};
const failure=(error,fallback)=>new Error(error?.message?.replace(/^Invalid segment (proposal|geometry): /,'')||fallback);

export async function listSegments({scope='all',query='',activity='',area=null,offset=0,limit=SEGMENT_PAGE}={},client=supabase){
 const {data,error}=await need(client).rpc('list_segments',{p_scope:scope,p_query:query.trim()||null,p_activity:activity||null,
  p_min_lat:area?.minLat??null,p_max_lat:area?.maxLat??null,p_min_lon:area?.minLon??null,p_max_lon:area?.maxLon??null,p_limit:limit,p_offset:offset});
 if(error)throw failure(error,'Segments could not be loaded.');
 return data||[];
}

export async function segmentDetail(id,client=supabase){
 const {data,error}=await need(client).rpc('segment_detail',{p_id:id});
 if(error)throw failure(error,'This segment could not be loaded.');
 return data||null;
}

export async function updateSegment(id,{name=null,geometry=null,note=''}={},client=supabase){
 const {data,error}=await need(client).rpc('update_segment',{p_id:id,p_name:name,p_geometry:geometry,p_note:note});
 if(error)throw failure(error,'The segment was not changed.');
 return data;
}

export async function deleteSegment(id,note='',client=supabase){
 const {error}=await need(client).rpc('delete_segment',{p_id:id,p_note:note});
 if(error)throw failure(error,'The segment was not deleted.');
}

export async function segmentsForMap(area,client=supabase){
 const {data,error}=await need(client).rpc('segments_for_map',{p_min_lat:area.minLat,p_max_lat:area.maxLat,p_min_lon:area.minLon,p_max_lon:area.maxLon});
 if(error)throw failure(error,'Segments could not be loaded for this area.');
 // Simplified once here: the native map draws lines, it does not need every fix.
 return (data||[]).map(row=>({...row,geometry:simplifyGeometry(row.geometry,8)}));
}

// An area around a point, for Nearby (about 10 km each way).
export function areaAround(point,km=10){
 if(!point||!Number.isFinite(point.latitude)||!Number.isFinite(point.longitude))return null;
 const dLat=km/111.32,dLon=km/(111.32*Math.max(0.2,Math.cos(point.latitude*Math.PI/180)));
 return {minLat:point.latitude-dLat,maxLat:point.latitude+dLat,minLon:point.longitude-dLon,maxLon:point.longitude+dLon};
}
const tooWide=area=>area.maxLat-area.minLat>MAP_SEGMENT_MAX_SPAN||area.maxLon-area.minLon>MAP_SEGMENT_MAX_SPAN;
// Areas are rounded so small pans inside the same area reuse the last result.
const areaKey=area=>[area.minLat,area.maxLat,area.minLon,area.maxLon].map(v=>v.toFixed(2)).join(',');

// The Map's Segments layer: loads only while on, only the settled visible area,
// and keeps the last result while the next area loads so lines never flicker.
// `version` changes when a segment is edited or deleted: everything is reloaded.
// A failed area is retried after a short wait.
export function useSegmentMapLayer(enabled,area,load=segmentsForMap,version=0){
 const [loaded,setLoaded]=useState({key:'',segments:[],errorKey:''});
 const [retry,setRetry]=useState(0);
 // Keyed by version and area, so an edit makes every earlier entry unreachable.
 const cache=useRef(new Map());
 const wide=Boolean(area)&&tooWide(area);
 const key=enabled&&area&&!wide?`${version}|${areaKey(area)}`:'';
 useEffect(()=>{
  if(!key||loaded.key===key)return undefined;
  let alive=true;
  const areas=cache.current;
  // A pan that settles again within a moment replaces this request.
  const timer=setTimeout(()=>{
   if(areas.has(key)){setLoaded({key,segments:areas.get(key),errorKey:''});return;}
   load(area).then(segments=>{
    if(!alive)return;
    areas.set(key,segments);
    if(areas.size>20)areas.delete(areas.keys().next().value);
    setLoaded({key,segments,errorKey:''});
   }).catch(()=>{
    if(!alive)return;
    setLoaded(previous=>({...previous,errorKey:key}));
    setTimeout(()=>{if(alive)setRetry(n=>n+1);},10000);
   });
  },350);
  return()=>{alive=false;clearTimeout(timer);};
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the rounded key is the area
 },[key,load,retry]);
 if(!enabled)return {segments:[],status:'idle'};
 if(wide)return {segments:loaded.segments,status:'zoom'};
 if(!key)return {segments:loaded.segments,status:'idle'};
 if(loaded.key===key)return {segments:loaded.segments,status:'ready'};
 return {segments:loaded.segments,status:loaded.errorKey===key?'error':'loading'};
}

export async function loadNotificationSettings(owner,client=supabase){
 const {data,error}=await need(client).from('notification_settings').select('segment_community,segment_personal').eq('user_id',owner).maybeSingle();
 if(error)throw failure(error,'Notification settings could not be loaded.');
 return {segment_community:data?.segment_community??true,segment_personal:data?.segment_personal??true};
}
export async function saveNotificationSettings(owner,settings,client=supabase){
 const {error}=await need(client).from('notification_settings').upsert({user_id:owner,...settings,updated_at:new Date().toISOString()});
 if(error)throw failure(error,'Notification settings were not saved.');
}

// Seconds as m:ss or h:mm:ss for effort times.
export function effortTime(seconds){
 if(!Number.isFinite(seconds))return '—';
 const total=Math.round(seconds),h=Math.floor(total/3600),m=Math.floor(total%3600/60),s=total%60;
 return h?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}`;
}
