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
// their selectable routes and live trail replace the overview. The same toolbar shows day/activity
// filters and map style; camera events use the same planner. Saved All people settings are retained.
// Named segments (namedSegments.segmentLayers): coloured lines above the route,
// a label per segment, and the recording muted while a section is being chosen.
const EMPTY=[];
export default function JourneyMap({journeys,onPhoto,selectedPhotoID=null,onJourney=null,large=false,currentPosition=null,onLocate,locating=false,homePresence=null,livePeople=EMPTY,peoplePins=EMPTY,embeddedEnabled=true,viewportKey=null,focusPoint=null,camera=null,onCamera=null,overview=null,controls=null,onControl=null,segmentLayer=null,onRegion=null,onSegment=null,personDay=null}){
 // Rebuilding the route payload on every render re-serialises a long recording's
 // geometry and re-sends it to the native map. Memoise so a photo-pin selection,
 // a camera mode change or an unrelated re-render reuses the previous bytes.
 const overviewKey=overview?.key||null;
 // Scope activity filters to the authorised day; keep the same toolbar and preserve All people settings.
 const toolbar=useMemo(()=>{
  if(!personDay||!controls)return controls;
  const filters=personDay.filters;
  const panel=controls.panel?.id==='filters'&&filters?{id:'filters',title:'Filters',reset:filters.active?{id:'pday:reset',label:'Reset filters',text:'Reset'}:null,sections:filters.sections}
   :controls.panel?.id==='layers'?{...controls.panel,sections:controls.panel.sections.filter(section=>section.id!=='community')}:null;
  return {...controls,active:filters?.active||0,filters:filters?{...controls.filters,id:'panel:filters',text:'Filters',label:'Activity filters',count:filters.active,expanded:panel?.id==='filters'}:undefined,panel,date:panel?null:personDay.date};
 },[personDay,controls]);
 const act=useCallback(id=>{if(personDay&&typeof id==='string'&&id.startsWith('pday:'))personDay.onControl(id);else onControl?.(id);},[personDay,onControl]);
 const payload=useMemo(()=>personDay?null:withCommunitySegments({...mapPayload(journeys,currentPosition,homePresence,livePeople,peoplePins,{overview:overviewKey,selectedPhotoID}),...(focusPoint?{focus:[focusPoint.latitude,focusPoint.longitude]}:{}),...(camera?{camera}:{})},segmentLayer),[personDay,journeys,currentPosition,homePresence,livePeople,peoplePins,overviewKey,selectedPhotoID,focusPoint,camera,segmentLayer]);
 const personPayload=useMemo(()=>personDay?{...personDay.payload,...(camera?{camera:{...camera,includeRoutes:false}}:{})}:null,[personDay,camera]);
 return <AppleMap viewportKey={viewportKey} embeddedEnabled={embeddedEnabled} onLocate={personDay?personDay.onLocate:onLocate} locating={personDay?personDay.locating:locating} onCamera={onCamera} overview={personDay?null:overview} controls={toolbar} onControl={personDay?act:onControl} onRegion={personDay?null:onRegion} onSegment={personDay?null:onSegment} dynamic={Boolean(personDay)} onStep={personDay?.onStep} payload={personPayload||payload} large={large} onResult={result=>{
  if(!result?.photoID)return;
  // Only a journey this map was given, and only one that owns the photo.
  const journey=journeys.find(j=>String(j.id)===result.journeyID);
  if(!journey||!journey.photos?.some(photo=>String(photo.id)===String(result.photoID)))return;
  if(result.action==='journey')onJourney?.(journey);
  else onPhoto?.(journey,result.photoID);
 }}/>;
}
