import {metres} from './journeyGeometry.js';

// POI points are not venue boundaries. Only an explicit shopping-centre search
// result near a recorded, sufficiently long native stop can name its destination.
// Do not treat arbitrary nearby businesses or the whole inactive interval as GPS dwell.
export function recognisedStopVenue(record,point,durationSeconds){
 if(!record?.stopLookup||!Number.isFinite(durationSeconds)||durationSeconds<300||
    !Number.isFinite(point?.latitude)||!Number.isFinite(point?.longitude))return null;
 const centres=(record.candidates||[]).filter(c=>
  c?.category==='shoppingCentre'&&typeof c.name==='string'&&c.name.trim()&&
  Number.isFinite(c.latitude)&&Number.isFinite(c.longitude))
  .map(c=>({...c,distance:metres(point,c)}))
  .filter(c=>c.distance<=250)
  .sort((a,b)=>a.distance-b.distance);
 if(!centres.length)return null;
 // Nearby competing shopping centres make the location uncertain. Don't assert
 // either as a visited destination merely because its map pin is closest.
 if(centres.length>1&&centres[1].distance-centres[0].distance<100)return null;
 return {name:centres[0].name.trim(),source:record.source||'Apple Maps',
  distanceMeters:Math.round(centres[0].distance),category:'shoppingCentre'};
}
