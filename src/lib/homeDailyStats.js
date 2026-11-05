import {chosenDay,matchesDate} from './activityFilters.js';
import {shiftMapDay} from './mapLayers.js';

// Keep the Home summary in sync with the default Activities listing.
export function homeJourneysForDay(journeys,archivedIDs,selection,today){
 const archived=new Set(archivedIDs);
 return journeys.filter(journey=>!journey.readOnly&&!archived.has(journey.id)&&matchesDate(journey,selection,today));
}

// Allocate only the recorded portion falling inside the selected local calendar
// day. A grouped journey is made of distinct recordings, not one continuous
// recording: gaps between its segments must never receive distance or time.
export function dailyJourneyTotals(journeys,selection,today){
 const day=chosenDay(selection,today);
 if(!day)return {count:0,distanceMeters:0,durationSeconds:0};
 const start=new Date(day+'T00:00:00').getTime()/1000;
 const end=new Date(shiftMapDay(day,1)+'T00:00:00').getTime()/1000;
 let distanceMeters=0;
 let durationSeconds=0;
 for(const journey of journeys){
  const parts=journey.segments?.length?journey.segments:[journey];
  for(const part of parts){
   const distance=Math.max(0,Number(part.distanceMeters)||0);
   const duration=Math.max(0,Number(part.durationSeconds)||0);
   const from=part.startedAt,to=part.endedAt;
   if(Number.isFinite(from)&&Number.isFinite(to)&&to>from){
    const overlap=Math.max(0,Math.min(to,end)-Math.max(from,start));
    // Recorded duration can differ from elapsed time (e.g. pauses). Distribute
    // only the actual recorded duration, not the entire clock-time interval.
    const share=overlap/(to-from);
    distanceMeters+=distance*share;
    durationSeconds+=duration*share;
   }else if(part.date===day){
    // Legacy or in-progress records without complete timestamps are assigned
    // to their known day, rather than duplicated across several days.
    distanceMeters+=distance;
    durationSeconds+=duration;
   }
  }
 }
 return {count:journeys.length,distanceMeters,durationSeconds};
}
