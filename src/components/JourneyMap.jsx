import {useMemo} from 'react';
import AppleMap from './AppleMap.jsx';
import { mapPayload } from '../lib/appleMaps.js';
// `camera` (from mapCamera.cameraIntent) turns on the people map: show everyone,
// follow a person, free exploring and edge avatars. Without it the map fits its
// routes as before.
//
// `overview` (from mapOverview) draws the journeys as a density map with
// clustered photos instead of one line, Start and Finish per journey. Selecting a
// photo there highlights its journey in a native preview card, whose actions
// come back as `action: 'journey'` or `'photo'`. Elsewhere a photo opens directly.
// Named segments (namedSegments.segmentLayers): coloured lines above the route,
// a label per segment, and the recording muted while a section is being chosen.
function withSegments(payload,layers){
 if(!layers)return payload;
 return {...payload,pins:[...payload.pins,...layers.pins],styled:layers.styled,...(layers.muted?{muted:true}:{})};
}
const EMPTY=[];
export default function JourneyMap({journeys,onPhoto,selectedPhotoID=null,onJourney=null,large=false,currentPosition=null,onLocate,locating=false,trimRange=null,segmentLayers=null,homePresence=null,livePeople=EMPTY,peoplePins=EMPTY,embeddedEnabled=true,viewportKey=null,focusPoint=null,camera=null,onCamera=null,overview=null,controls=null,onControl=null,overlay=false}){
 // Rebuilding the route payload on every render re-serialises a long recording's
 // geometry and re-sends it to the native map. Memoise so a photo-pin selection,
 // a camera mode change or an unrelated re-render reuses the previous bytes.
 const overviewKey=overview?.key||null;
 const payload=useMemo(()=>({...withSegments(mapPayload(journeys,currentPosition,homePresence,livePeople,peoplePins,{overview:overviewKey,selectedPhotoID}),segmentLayers),...(focusPoint?{focus:[focusPoint.latitude,focusPoint.longitude]}:{}),...(camera?{camera}:{})}),[journeys,currentPosition,homePresence,livePeople,peoplePins,overviewKey,selectedPhotoID,segmentLayers,focusPoint,camera]);
 return <AppleMap viewportKey={viewportKey} embeddedEnabled={embeddedEnabled} onLocate={onLocate} locating={locating} onCamera={onCamera} overview={overview} controls={controls} onControl={onControl} overlay={overlay} payload={payload} trimRange={trimRange} large={large} onResult={result=>{
  if(!result?.photoID)return;
  // Only a journey this map was given, and only one that owns the photo.
  const journey=journeys.find(j=>String(j.id)===result.journeyID);
  if(!journey||!journey.photos?.some(photo=>String(photo.id)===String(result.photoID)))return;
  if(result.action==='journey')onJourney?.(journey);
  else onPhoto?.(journey,result.photoID);
 }}/>;
}
