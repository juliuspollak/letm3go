import {publishActivity} from './activitySharing.js';

// Household members' new activities are shared with the household by default, using
// the same publish path as the Share sheet (Home/Work masking, backup, recipient
// snapshot). The server decides which activities qualify (my_auto_share_pending:
// recorded since sharing began, never decided by the owner, not yet shared), so a
// private activity, a manual unshare or an older activity is never published here.
export async function shareNewHouseholdActivities({client,recorder,receipts,checkpoint,limit=5}){
 const {data:pending,error}=await client.rpc('my_auto_share_pending',{p_limit:limit});
 if(error||!Array.isArray(pending)||!pending.length)return {published:[],failed:[]};
 const state=await recorder.getState();
 const published=[],failed=[];
 for(const {activity_id:id} of pending){
  const trip=(state.trips||[]).find(t=>t.id.toLowerCase()===String(id).toLowerCase());
  // Not on this phone (recorded elsewhere), unfinished, or not a GPS recording: skip.
  if(!trip||!trip.endedAt||!['device','watch'].includes(trip.source)||!(trip.points||[]).length)continue;
  try{
   await publishActivity({client,state,id:trip.id,reviewedTrip:trip,audience:'household',mode:'household',receipts:receipts||{},checkpoint});
   published.push(id);
  }catch(error){
   // A missing Home place or an offline phone is not an error to surface; the next
   // pass tries again. Stop here so one problem is not repeated for every activity.
   failed.push({id,message:error.message});break;
  }
 }
 return {published,failed};
}
