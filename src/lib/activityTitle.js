import {activityCode,activityLabel} from './activityNames.js';
export function automaticTitle(trip){
 return trip.recordingMode==='automatic'&&(trip.title==='Automatically detected journey'||/ · Automatically detected$/.test(trip.title)||trip.title===trip.activity);
}
export function activityTitle(trip){
 if(automaticTitle(trip))return trip.activity==='Unknown'?'Journey':activityLabel(trip.activity);
 // Default iPhone/Watch titles include a date after the separator. This is a
 // display projection; personal titles and stored titles are never rewritten.
 if(activityCode(trip.activity)==='MTB'&&/^MTB · \d/.test(trip.title||''))return trip.title.replace(/^MTB/,activityLabel('MTB'));
 return trip.title;
}

const genericPlaces=new Set(['unknown location','unnamed stop','start','destination']);
function placeName(place){
 const name=(place?.name||place?.nearbyName||place?.locality||'').trim();
 return name&&!genericPlaces.has(name.toLowerCase())?name:null;
}
export function contextualJourneyTitle(activity,from,to,isLoop=false){
 const place=placeName(to)||placeName(from);
 if(!place)return activity==='Unknown'?'Journey':activityLabel(activity);
 if(activity==='Driving'){
  if(to?.kind==='home')return 'Driving home';
  if(to?.kind==='work')return 'Driving to work';
  if(isLoop)return `Drive around ${place}`;
  return `Driving to ${place}`;
 }
 if(activity==='Walking')return isLoop?`Walk around ${place}`:`Walk to ${place}`;
 if(activity==='Running')return `Run around ${place}`;
 if(activity==='Hiking')return `Hike around ${place}`;
 if(activityCode(activity)==='MTB')return `Mountain biking around ${place}`;
 if(activity==='Cycling'||activity==='Road cycling')return isLoop?`Ride around ${place}`:`Ride to ${place}`;
 if(activity==='Kitesurfing')return `Kitesurfing at ${place}`;
 return activity==='Unknown'?`Journey near ${place}`:`${activityLabel(activity)} around ${place}`;
}
