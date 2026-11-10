import {isCommunitySegmentActivity} from './namedSegments.js';
export const SEGMENT_PUBLICATION_VERSION=1;
export function segmentReceipt(receipts,id){return receipts[`mtb-segment:${id.toLowerCase()}`]||receipts[`mtb-segment:${id}`];}
export const segmentFingerprint=segment=>`${segment.name}|${segment.startIndex}|${segment.endIndex}`;

// Local sections are ordinary Mine entries while offline/recovering. Detailed
// receipts stay private for retries and opt-in support diagnostics, not status UI.
export function localSegmentStates(journeys,receipts={},owner=null){
 const rows=[],seen=new Set();
 for(const trip of journeys||[]){
  if(!isCommunitySegmentActivity(trip?.activity)||trip.details?.provisional)continue;
  for(const segment of trip.details?.namedSegments||[]){
   if(typeof segment.id!=='string')continue;
   const id=segment.id.toLowerCase();if(seen.has(id))continue;seen.add(id);
   const receipt=segmentReceipt(receipts,segment.id);
   const mine=receipt&&(!owner||receipt.owner?.toLowerCase()===owner.toLowerCase());
   const current=mine&&receipt.fingerprint===segmentFingerprint(segment)&&receipt.publicationVersion===SEGMENT_PUBLICATION_VERSION;
   if(current&&receipt.blocked&&!receipt.ownershipMismatch)continue;
   const state=current&&receipt.ownershipMismatch?'refused':current&&receipt.uploaded?'published':current&&receipt.skipped?'refused':current&&receipt.failed?'failed':'pending';
   const persistent=state==='failed'&&(receipt.attempts||0)>=3&&Date.now()-(receipt.firstFailureAt||Date.now())>=10*60000;
   rows.push({id,name:segment.name,activity:trip.activity,activityID:trip.id,state,distanceMeters:segment.distanceMeters||0,
    warning:state==='refused'?receipt.reason||'Open the original activity to adjust this section.':persistent?'This section could not be shared. Check your connection or contact support.':null});
  }
 }
 return rows;
}
