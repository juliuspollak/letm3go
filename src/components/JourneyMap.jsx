import {useCallback,useMemo} from 'react';
import AppleMap from './AppleMap.jsx';
import { mapPayload } from '../lib/appleMaps.js';
import {withCommunitySegments} from '../lib/mapContent.js';
// `camera` (from mapCamera.cameraIntent) turns on the people map: show everyone,
// follow a person, free exploring and edge avatars. Without it the map fits its
// routes as before.
//
// `overview` (from mapOverview) draws the journeys as a density map with
// clustered photos instead of one line, Start and Finish per journey. Selecting a
// photo there highlights its journey in a native preview card, whose actions
// come back as `action: 'journey'` or `'photo'`. Elsewhere a photo opens directly.
// `personDay` ({payload,onStep,date,onControl,onLocate,locating}, from PersonMap) turns this same map into one person's day:
// their lines, live trail and numbered markers replace the layers; the map's own toolbar stays (Layers, the date bar for the
// person's days, Locate) but Filters, which do not apply to a person, are left out, through the same native
// map (updated in place, `dynamic`), and the saved Map settings are left untouched.
// Named segments (namedSegments.segmentLayers): coloured lines above the route,
// a label per segment, and the recording muted while a section is being chosen.
const EMPTY=[];
export default function JourneyMap({journeys,onPhoto,selectedPhotoID=null,onJourney=null,large=false,currentPosition=null,onLocate,locating=false,homePresence=null,livePeople=EMPTY,peoplePins=EMPTY,embeddedEnabled=true,viewportKey=null,focusPoint=null,camera=null,onCamera=null,overview=null,controls=null,onControl=null,segmentLayer=null,onRegion=null,onSegment=null,personDay=null}){
 // Rebuilding the route payload on every render re-serialises a long recording's
 // geometry and re-sends it to the native map. Memoise so a photo-pin selection,
 // a camera mode change or an unrelated re-render reuses the previous bytes.
 const overviewKey=overview?.key||null;
 // The map's own toolbar in a person's day: no Filters (they describe the routes layers), the person's date bar,
 // and Layers as in All people, but only the map style: Segments and Friends' journeys are layers of the All people map and
 // would be switched on with nothing drawn here (their settings are kept for when it is shown again).
 const toolbar=useMemo(()=>personDay&&controls?{...controls,filters:undefined,active:0,panel:controls.panel?.id==='layers'?{...controls.panel,sections:controls.panel.sections.filter(section=>section.id!=='community')}:null,date:controls.panel?.id==='layers'?null:personDay.date}:controls,[personDay,controls]);
 const act=useCallback(id=>{if(personDay&&typeof id==='string'&&id.startsWith('pday:'))personDay.onControl(id);else onControl?.(id);},[personDay,onControl]);
 const payload=useMemo(()=>personDay?null:withCommunitySegments({...mapPayload(journeys,currentPosition,homePresence,livePeople,peoplePins,{overview:overviewKey,selectedPhotoID}),...(focusPoint?{focus:[focusPoint.latitude,focusPoint.longitude]}:{}),...(camera?{camera}:{})},segmentLayer),[personDay,journeys,currentPosition,homePresence,livePeople,peoplePins,overviewKey,selectedPhotoID,focusPoint,camera,segmentLayer]);
 return <AppleMap viewportKey={viewportKey} embeddedEnabled={embeddedEnabled} onLocate={personDay?personDay.onLocate:onLocate} locating={personDay?personDay.locating:locating} onCamera={personDay?null:onCamera} overview={personDay?null:overview} controls={toolbar} onControl={personDay?act:onControl} onRegion={personDay?null:onRegion} onSegment={personDay?null:onSegment} dynamic={Boolean(personDay)} onStep={personDay?.onStep} payload={personDay?personDay.payload:payload} large={large} onResult={result=>{
  if(!result?.photoID)return;
  // Only a journey this map was given, and only one that owns the photo.
  const journey=journeys.find(j=>String(j.id)===result.journeyID);
  if(!journey||!journey.photos?.some(photo=>String(photo.id)===String(result.photoID)))return;
  if(result.action==='journey')onJourney?.(journey);
  else onPhoto?.(journey,result.photoID);
 }}/>;
}
