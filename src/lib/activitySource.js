// Auto vs Manual: which of your own activities the Activities list shows. Automatic
// activities are the ones the phone detected and recorded by itself; everything else
// (started by hand, Apple Watch, linked sources) counts as manual. The choice belongs
// to the profile, so it is stored with the other account preferences.
export const ACTIVITY_SOURCES=['all','automatic','manual'];
export function activitySource(value){return ACTIVITY_SOURCES.includes(value)?value:'all';}
export function isAutomaticActivity(trip){return trip?.recordingMode==='automatic';}
// Shared rows carry no recording mode, so they are never filtered out by this choice.
export function matchesActivitySource(trip,source){
 if(source==='all'||trip?.isShared)return true;
 return source==='automatic'?isAutomaticActivity(trip):!isAutomaticActivity(trip);
}
export function activitySourceCounts(trips){
 const owned=(trips||[]).filter(trip=>!trip?.isShared);
 const automatic=owned.filter(isAutomaticActivity).length;
 return {all:owned.length,automatic,manual:owned.length-automatic};
}
