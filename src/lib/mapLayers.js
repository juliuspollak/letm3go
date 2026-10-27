const routeLayers=['today','pinned','all'];
export function toggleMapLayer(layers,id){
 if(id!=='people'&&!routeLayers.includes(id))return layers;
 if(layers.includes(id))return layers.filter(value=>value!==id);
 return [...layers.filter(value=>id==='people'||!routeLayers.includes(value)),id];
}
export function mapLayerJourneys(journeys,layers,today,saved=[]){
 if(layers.includes('all'))return journeys;
 return journeys.filter(trip=>layers.includes('today')&&(trip.date===today||trip.segments?.some(segment=>segment.date===today))||layers.includes('pinned')&&(saved.includes(trip.id)||trip.segmentIDs?.some(id=>saved.includes(id))));
}
