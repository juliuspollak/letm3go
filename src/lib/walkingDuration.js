export function isAutomaticWalk(trip){
 return trip?.recordingMode==='automatic'&&['Walking','Hiking','Running'].includes(trip.activity);
}

export function walkingDuration(trip){
 if(!isAutomaticWalk(trip))return null;
 const interval=Number.isFinite(trip.startedAt)&&Number.isFinite(trip.endedAt)&&trip.endedAt>=trip.startedAt
  ?trip.endedAt-trip.startedAt:null;
 const elapsed=interval??(Number.isFinite(trip.elapsedSeconds)&&trip.elapsedSeconds>=0?trip.elapsedSeconds:null);
 const moving=trip.details?.walkingMovingSeconds??trip.movingSeconds;
 // ISO timestamps in cloud rows carry millisecond precision.
 const valid=Number.isFinite(moving)&&moving>=0&&(elapsed==null||Math.round(moving*1000)<=Math.round(elapsed*1000));
 return {elapsed,moving:valid?(elapsed==null?moving:Math.min(moving,elapsed)):null};
}
