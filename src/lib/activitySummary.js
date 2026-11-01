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

// A change smaller than this is treated as GPS altitude jitter, not a climb. The
// previous behaviour summed every positive delta, so a watch fix that wandered a
// metre up and down inflated the gain by thousands of metres on a long ride.
export const ELEVATION_HYSTERESIS_METERS=4;

// A usable altitude fix. Phone and Watch altitude is barometric/GPS-derived and a
// missing value is commonly written as 0, which would otherwise fabricate a climb
// from sea level. A low-accuracy fix is skipped without breaking the segment: it
// is not trustworthy enough to move the reference, but it is still a real sample
// in a continuous track.
function usableAltitude(point){
 const altitude=point?.altitude;
 if(!finite(altitude)||altitude===0||altitude<-500||altitude>9000)return null;
 const accuracy=point?.accuracy;
 if(finite(accuracy)&&accuracy>50)return undefined;
 return altitude;
}

// Positive altitude change from the fixes. A value saved with the activity is
// preferred because it was computed from the full, unfiltered recording. A derived
// value uses hysteresis and ignores invalid fixes, pauses (a time gap) and segment
// jumps, so the number is a conservative estimate rather than raw GPS noise.
export function elevationGainMeters(trip){
 const saved=[trip?.details?.elevationGain,trip?.details?.elevationGainMeters,trip?.elevationGainMeters,trip?.elevationGain];
 for(const candidate of saved)if(finite(candidate)&&candidate>=0)return candidate;
 const points=Array.isArray(trip?.points)?trip.points:[];
 let reference=null,segment=null,lastTime=null,gain=0;
 for(const point of points){
  const altitude=usableAltitude(point);
  if(altitude===null){reference=null;segment=null;lastTime=null;continue;}
  const current=finite(point?.segment)?point.segment:0;
  const time=finite(point?.timestamp)?point.timestamp:null;
  if(altitude===undefined){lastTime=time;continue;}
  const breakInTrack=current!==segment||(time!=null&&lastTime!=null&&time-lastTime>300);
  if(breakInTrack){reference=altitude;segment=current;lastTime=time;continue;}
  const delta=altitude-reference;
  // Hysteresis: only a change larger than the noise floor moves the reference. A
  // descent never counts as gain and resets the reference for the next climb.
  if(Math.abs(delta)>ELEVATION_HYSTERESIS_METERS){
   if(delta>0)gain+=delta;
   reference=altitude;
  }
  lastTime=time;
 }
 return gain>0?gain:null;
}

// Apple Watch reports active energy, which is what "calories" means to a rider.
// Every plausible key is checked, but a value is only returned when it is a real
// number in a plausible range; nothing is derived from heart rate. `source` is
// only 'watch' when the recording itself says so: a generic trip.calories must
// never be presented as Apple Watch active energy.
export function activeCalories(trip){
 const details=trip?.details||{};
 // Unitless legacy aliases may contain joules or total rather than active
 // energy. Only explicitly kilocalorie-valued fields can enter this readout.
 const candidates=[
  [details.activeEnergyKcal,'Active calories'],
  [trip?.activeEnergyKcal,'Active calories'],
  [details.activeEnergyUnit==='kcal'?details.activeEnergy:undefined,'Active calories'],
  [details.caloriesKcal,'Calories']
 ];
 for(const [value,label] of candidates){
  if(!finite(value)||value<0||value>20000)continue;
  const measuredWatch=label==='Active calories'&&trip?.source==='watch'&&details.energySource==='healthkit';
  return {kcal:Math.round(value),label,source:measuredWatch?'watch':null};
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
 const savedElevation=[trip?.details?.elevationGain,trip?.details?.elevationGainMeters,trip?.elevationGainMeters,trip?.elevationGain].some(value=>finite(value)&&value>=0);
 if(elevation!=null)entries.push({id:'elevation',label:'Elevation gain',value:`${Math.round(elevation)} m`,detail:savedElevation?null:'Estimated from recorded altitude'});
 const heart=heartRateSummary(trip);
 if(heart)entries.push({id:'heart',label:'Avg heart rate',value:`${heart.average} BPM`,detail:heart.maximum?`Max ${heart.maximum} BPM`:null});
 const energy=activeCalories(trip);
 if(energy)entries.push({id:'calories',label:energy.label,value:`${energy.kcal} kcal`,detail:energy.source==='watch'?'From Apple Watch active energy':null});
 return entries;
}
