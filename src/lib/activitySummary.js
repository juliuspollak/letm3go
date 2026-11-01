import {distanceText} from './distanceUnits.js';

// The at-a-glance summary at the top of an activity. It only ever reports values
// the recording actually holds: an absent calorie or heart-rate value is omitted
// rather than guessed, and a missing moving time is labelled as elapsed time.
const finite=Number.isFinite;

export function durationText(seconds){
 const total=Math.max(0,Math.round(finite(seconds)?seconds:0));
 const hours=Math.floor(total/3600),minutes=Math.floor(total/60)%60,rest=total%60;
 if(hours)return `${hours} h ${minutes} min`;
 if(minutes)return `${minutes} min`;
 return `${rest} s`;
}

// Positive altitude change from the fixes. A value saved with the activity is
// preferred because it was computed from the full, unfiltered recording.
export function elevationGainMeters(trip){
 const saved=[trip?.details?.elevationGain,trip?.details?.elevationGainMeters,trip?.elevationGainMeters,trip?.elevationGain];
 for(const candidate of saved)if(finite(candidate)&&candidate>=0)return candidate;
 const points=Array.isArray(trip?.points)?trip.points:[];
 let previous=null,gain=0;
 for(const point of points){
  const altitude=point?.altitude;
  if(!finite(altitude))continue;
  if(previous!=null&&altitude>previous)gain+=altitude-previous;
  previous=altitude;
 }
 return gain>0?gain:null;
}

// Apple Watch reports active energy, which is what "calories" means to a rider.
// Every plausible key is checked, but a value is only returned when it is a real
// number in a plausible range; nothing is derived from heart rate.
export function activeCalories(trip){
 const details=trip?.details||{};
 const candidates=[
  [details.activeCalories,'Active calories'],
  [details.activeEnergyKcal,'Active calories'],
  [details.activeEnergy,'Active calories'],
  [details.caloriesKcal,'Calories'],
  [trip?.activeCalories,'Active calories'],
  [trip?.calories,'Calories']
 ];
 for(const [value,label] of candidates){
  if(!finite(value)||value<=0||value>20000)continue;
  return {kcal:Math.round(value),label};
 }
 return null;
}

export function heartRateSummary(trip){
 const summary=trip?.details?.heartRate?.summary;
 if(!summary||!finite(summary.average)||summary.average<=0)return null;
 return {average:Math.round(summary.average),maximum:finite(summary.maximum)?Math.round(summary.maximum):null};
}

// Ordered so the first two readout blocks always carry the most useful
// comparison for a ride or hike: how far, then how long.
export function activitySummary(trip,{unit='km'}={}){
 const entries=[];
 const distanceKm=finite(trip?.distanceMeters)?trip.distanceMeters/1000:finite(trip?.distance)?trip.distance:null;
 if(distanceKm!=null)entries.push({id:'distance',label:'Distance',value:distanceText(distanceKm,unit)});
 const movingSeconds=[trip?.details?.movingSeconds,trip?.details?.movingTimeSeconds].find(value=>finite(value)&&value>0);
 const elapsedSeconds=finite(trip?.durationSeconds)?trip.durationSeconds:Number.isFinite(trip?.minutes)?trip.minutes*60:null;
 if(movingSeconds!=null)entries.push({id:'moving',label:'Moving time',value:durationText(movingSeconds)});
 if(elapsedSeconds!=null)entries.push({id:'elapsed',label:movingSeconds!=null?'Elapsed time':'Time',value:durationText(elapsedSeconds)});
 const elevation=elevationGainMeters(trip);
 if(elevation!=null)entries.push({id:'elevation',label:'Elevation gain',value:`${Math.round(elevation)} m`});
 const heart=heartRateSummary(trip);
 if(heart)entries.push({id:'heart',label:'Avg heart rate',value:`${heart.average} BPM`,detail:heart.maximum?`Max ${heart.maximum} BPM`:null});
 const energy=activeCalories(trip);
 if(energy)entries.push({id:'calories',label:energy.label,value:`${energy.kcal} kcal`,detail:'From Apple Watch active energy'});
 return entries;
}
