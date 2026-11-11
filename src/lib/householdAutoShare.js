import {publishActivity} from './activitySharing.js';
import {flushPendingHides,isLiveHidden} from './hideLiveActivity.js';

// Household members' new activities are shared with the household by default, using
// the same publish path as the Share sheet (Home/Work masking, backup, recipient
// snapshot). The server decides which activities qualify (my_auto_share_pending:
// recorded since sharing began, never decided by the owner, not yet shared), so a
// private activity, a manual unshare or an older activity is never published here.
export async function shareNewHouseholdActivities({client,recorder,receipts,checkpoint,limit=5}){
 // Tell the server about any "keep private" it has not heard yet before anything is published.
 await flushPendingHides(client);
 const published=[],failed=[],skip=new Set();
 let state=null;
 // The server lists newest first. Ones this phone cannot publish (recorded on another
 // device, unfinished, not GPS) are excluded from the next page so they never crowd out
 // the ones it can.
 for(let round=0;round<4&&published.length<limit;round++){
  const {data:pending,error}=await client.rpc('my_auto_share_pending',{p_limit:25,p_exclude:[...skip]});
  if(error||!Array.isArray(pending)||!pending.length)break;
  state||=await recorder.getState();
  let usable=0;
  for(const {activity_id:id} of pending){
   const trip=(state.trips||[]).find(t=>t.id.toLowerCase()===String(id).toLowerCase());
   // Not on this phone, unfinished, not GPS, or one I marked private while recording.
   if(!trip||!trip.endedAt||!['device','watch'].includes(trip.source)||!(trip.points||[]).length||isLiveHidden(trip.id)){skip.add(id);continue;}
   usable++;
   try{
    await publishActivity({client,state,id:trip.id,reviewedTrip:trip,audience:'household',mode:'household',auto:true,receipts:receipts||{},checkpoint});
    published.push(id);
    if(published.length>=limit)break;
   }catch(error){
    // One activity that cannot be published (a revision mismatch, bad points) must not
    // hold up the rest: skip it this pass. A few failures in a row mean something is wrong
    // for everything (offline, no Home place), so stop instead of repeating it.
    skip.add(id);failed.push({id,message:error.message});
    if(failed.length>=3)return {published,failed};
   }
  }
  // Something publishable was in this page: done. A page of nothing but unpublishable
  // activities asks again with those excluded.
  if(usable)break;
 }
 return {published,failed};
}
