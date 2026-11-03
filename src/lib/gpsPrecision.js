// How hard GPS works during a recording, chosen per activity. RecordingPrecision in
// WatchActivityCore.swift holds the same three levels and defaults for the Watch.
export const GPS_PRECISIONS=[
 {id:'high',label:'High',detail:'Holds tight corners. Uses the most battery.'},
 {id:'balanced',label:'Balanced',detail:'Good for most activities.'},
 {id:'saver',label:'Battery saver',detail:'For long days. Corners look rougher.'},
];
export const precisionOffered=activity=>activity!=='Driving';
export const defaultPrecision=activity=>activity==='MTB'?'high':'balanced';
const key=activity=>`letm3go-gps-precision:${activity}`;
export function savedPrecision(activity,storage=globalThis.localStorage){
 try{const value=storage?.getItem(key(activity));if(GPS_PRECISIONS.some(option=>option.id===value))return value;}catch{/* Unreadable storage is the default. */}
 return defaultPrecision(activity);
}
export function savePrecision(activity,value,storage=globalThis.localStorage){
 try{storage?.setItem(key(activity),value);}catch{/* The choice still applies to this recording. */}
}
