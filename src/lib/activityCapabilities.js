import {activityCode} from './activityNames.js';
import {ropeSummary,jumpsText} from './ropeSkipping.js';

// What an activity needs, decided in one place (the Swift twin is ActivityCapabilities in RecorderCore.swift)
// and read by every screen that lists or opens an activity. How an activity was started (manually or
// automatically) is a separate question and never decides this.
//   gps       the activity records GPS fixes
//   routeMap  its detail leads with the route map
// A subtype overrides its parent by being listed (Rope skipping under Gym) or by being recorded indoors.
export const WITHOUT_GPS=['Gym','Strength training','Pilates','Rope skipping'];
export function activityCapabilities(activity,{indoor}={}){
 const gps=!WITHOUT_GPS.includes(activityCode(activity))&&indoor!==true;
 return {gps,routeMap:gps};
}
export const capabilitiesOf=trip=>activityCapabilities(trip?.activity,{indoor:trip?.details?.indoor});
export const usesGPS=trip=>capabilitiesOf(trip).gps;

// The distance a friends' feed row may show, in km, or null. The feed carries only the activity name and a
// distance, never the indoor flag, so it is decided from what is there: a workout shared without GPS sends no
// distance (null), and a zero, which an older share of an indoor run or ride holds, is never shown as a distance.
export function feedDistanceKm(row){
 const km=row?.distance_km==null?NaN:Number(row.distance_km);
 return Number.isFinite(km)&&km>0&&activityCapabilities(row.activity).gps?km:null;
}
// What a trip sends as its feed distance when it is shared: nothing for an activity without GPS.
export const sharedDistanceKm=trip=>usesGPS(trip)?Math.max(0,(trip.distanceMeters||0)/1000):null;

// The one figure a list row leads with when there is no route to measure: jumps for rope skipping,
// otherwise minutes. A GPS activity returns null and shows its distance as before.
export function workoutFigure(trip){
 if(usesGPS(trip))return null;
 const rope=ropeSummary(trip);
 if(rope)return {value:jumpsText(rope.jumps),label:'jumps'};
 const minutes=Math.floor((Number.isFinite(trip?.durationSeconds)?trip.durationSeconds:(trip?.minutes||0)*60)/60);
 return {value:String(minutes),label:'min'};
}
