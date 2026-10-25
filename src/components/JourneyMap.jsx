import AppleMap from './AppleMap.jsx';
import { mapPayload } from '../lib/appleMaps.js';
export default function JourneyMap({journeys,onPhoto,large=false,currentPosition=null,onLocate,locating=false,trimRange=null,homePresence=null}){
 return <AppleMap onLocate={onLocate} locating={locating} payload={mapPayload(journeys,currentPosition,homePresence)} trimRange={trimRange} large={large} onResult={result=>{if(result.photoID){const journey=journeys.find(j=>String(j.id)===result.journeyID);if(journey)onPhoto?.(journey,result.photoID);}}}/>;
}
