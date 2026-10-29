import AppleMap from './AppleMap.jsx';
import { mapPayload } from '../lib/appleMaps.js';
export default function JourneyMap({journeys,onPhoto,large=false,currentPosition=null,onLocate,locating=false,trimRange=null,homePresence=null,livePeople=[],peoplePins=[],embeddedEnabled=true,viewportKey=null,focusPoint=null}){
 return <AppleMap viewportKey={viewportKey} embeddedEnabled={embeddedEnabled} onLocate={onLocate} locating={locating} payload={{...mapPayload(journeys,currentPosition,homePresence,livePeople,peoplePins),...(focusPoint?{focus:[focusPoint.latitude,focusPoint.longitude]}:{})}} trimRange={trimRange} large={large} onResult={result=>{if(result.photoID){const journey=journeys.find(j=>String(j.id)===result.journeyID);if(journey)onPhoto?.(journey,result.photoID);}}}/>;
}
