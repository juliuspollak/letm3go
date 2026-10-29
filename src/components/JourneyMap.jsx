import AppleMap from './AppleMap.jsx';
import { mapPayload } from '../lib/appleMaps.js';
// `camera` (from mapCamera.cameraIntent) turns on the people map: show everyone,
// follow a person, free exploring and edge avatars. Without it the map fits its
// routes as before.
export default function JourneyMap({journeys,onPhoto,large=false,currentPosition=null,onLocate,locating=false,trimRange=null,homePresence=null,livePeople=[],peoplePins=[],embeddedEnabled=true,viewportKey=null,focusPoint=null,camera=null,onCamera=null}){
 return <AppleMap viewportKey={viewportKey} embeddedEnabled={embeddedEnabled} onLocate={onLocate} locating={locating} onCamera={onCamera} payload={{...mapPayload(journeys,currentPosition,homePresence,livePeople,peoplePins),...(focusPoint?{focus:[focusPoint.latitude,focusPoint.longitude]}:{}),...(camera?{camera}:{})}} trimRange={trimRange} large={large} onResult={result=>{if(result.photoID){const journey=journeys.find(j=>String(j.id)===result.journeyID);if(journey)onPhoto?.(journey,result.photoID);}}}/>;
}
