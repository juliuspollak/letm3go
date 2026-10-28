import {tripEquipmentLabel} from './collection.js';

// iOS cannot afford to build hundreds of rows while a finger is on the screen, so
// the Trips list grows in pages instead of rendering the whole archive up front.
export const TRIP_PAGE_SIZE=40;

// Only a finished, own-device activity can be merged by dragging one row onto another.
export function canMergeTrip(trip){
 return !trip.readOnly&&!trip.provisional&&(trip.isGroupedJourney||trip.endedAt!=null&&trip.state!=='recording')&&(trip.isGroupedJourney||trip.source==='device');
}

// Why a search matched: tags and equipment beat stops and free text. Evaluated once
// per row (it used to run three times per row for every render of the list).
export function tripMatchReason(trip,query,vehicles){
 const q=(query||'').trim().toLowerCase();
 if(!q)return null;
 const stops=trip.stops||trip.recognisedStops||[];
 const tags=(trip.tags||[]).filter(tag=>tag.toLowerCase().includes(q));
 if(tags.length)return {label:'Matched tag',value:tags[0]};
 const equipment=tripEquipmentLabel(trip,vehicles);
 if(equipment&&equipment.toLowerCase().includes(q))return {label:'Matched equipment',value:equipment};
 const stop=stops.find(x=>[x.name,...(x.tags||[])].some(v=>v?.toLowerCase().includes(q)));
 if(stop)return {label:'Matched stop',value:stop.name};
 for(const [label,value] of [['Title',trip.title],['Location',trip.location],['Notes',trip.notes],['Collection',trip.collection],['Date',trip.date]])if(value?.toLowerCase().includes(q))return {label:'Matched '+label.toLowerCase(),value};
 return {label:'Matched trip details',value:q};
}
