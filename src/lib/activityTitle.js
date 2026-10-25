export function automaticTitle(trip){
 return trip.recordingMode==='automatic'&&(trip.title==='Automatically detected journey'||/ · Automatically detected$/.test(trip.title)||trip.title===trip.activity);
}
export function activityTitle(trip){return automaticTitle(trip)?(trip.activity==='Unknown'?'Journey':trip.activity):trip.title;}
