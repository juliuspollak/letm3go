// Segments made on this iPhone, and how far each got towards the community
// library, from the sync receipts cloudSync.js keeps (`mtb-segment:<id>`). The
// server only knows a segment once it is published; until then this is the
// only place the person can see that it is waiting, failed or was refused.
import {isCommunitySegmentActivity} from './namedSegments.js';

export const SEGMENT_SYNC_LABELS={
 pending:'Waiting to publish. It publishes on the next sync.',
 failed:'Not published yet. It will retry on the next sync.',
 refused:'Not published.',
 published:'Published',
};

export function localSegmentStates(journeys,receipts={},owner=null){
 const rows=[];
 for(const trip of journeys||[]){
  if(!isCommunitySegmentActivity(trip?.activity))continue;
  for(const segment of trip.details?.namedSegments||[]){
   const receipt=receipts?.[`mtb-segment:${segment.id}`];
   const mine=receipt&&(!owner||receipt.owner===owner);
   const fingerprint=`${segment.name}|${segment.startIndex}|${segment.endIndex}`;
   // An edit made since the last upload is waiting again, whatever happened before.
   const current=mine&&(!receipt.fingerprint||receipt.fingerprint===fingerprint);
   const state=!mine||!current?'pending':receipt.uploaded?'published':receipt.skipped?'refused':receipt.failed?'failed':'pending';
   rows.push({id:segment.id,name:segment.name,activity:trip.activity,activityID:trip.id,state,
    reason:state==='refused'?receipt.reason||'The server could not publish this section.':state==='failed'?receipt.failed:null});
  }
 }
 return rows;
}
