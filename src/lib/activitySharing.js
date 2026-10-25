import { syncPrivateActivities } from './cloudSync.js';
export async function sharingRequest(client,action,id,params={}){
 if(!client)throw new Error('Sign in while online to change privacy.');
 const {data:auth,error:authError}=await client.auth.getUser();if(authError||!auth.user)throw new Error('Sign in while online to change privacy.');
 const {data,error}=await client.functions.invoke('journeys',{body:{action,id,...params},timeout:20000});
 if(error||data?.error||!data)throw new Error('Sharing could not be confirmed. The journeys backend may need deployment. Your last confirmed permission has not been changed in this screen.');
 return data;
}
export async function publishActivity({client,state,id,receipts,checkpoint,reviewedTrip}){
 const {data:auth,error}=await client.auth.getUser();const owner=auth?.user?.id;
 if(error||!owner||state.ownerID?.toLowerCase()!==owner.toLowerCase())throw new Error('This activity belongs to a different account.');
 const trip=state.trips.find(t=>t.id===id);if(!trip||trip.source!=='device'||!trip.endedAt)throw new Error('Only completed iPhone activities can be shared.');
 if(reviewedTrip&&(JSON.stringify(trip.points)!==JSON.stringify(reviewedTrip.points)||trip.activity!==reviewedTrip.activity||(trip.details?.description||'')!==(reviewedTrip.description||'')))throw new Error('Activity changed. Close privacy controls and review the latest activity before publishing.');
 const backup=await syncPrivateActivities(client,{...state,trips:[trip],deletedIDs:[]},receipts,{checkpoint});
 const {data:current,error:readError}=await client.from('activities').select('revision').eq('id',id).eq('owner_id',owner).single();
 if(readError||!Number.isInteger(current?.revision))throw new Error('The current activity could not be verified.');
 const {data:again,error:accountError}=await client.auth.getUser();if(accountError||again.user?.id!==owner)throw new Error('Account changed. Publication cancelled.');
 const result=await sharingRequest(client,'publish',id,{audience:'public',revision:current.revision,placesConfirmed:true,photoIDs:[]});
 if(!result.token)throw new Error('Publication was not confirmed.');
 return {...result,receipts:backup.receipts};
}
export async function makeActivityPrivate(client,id){
 const {data:auth,error}=await client.auth.getUser();if(error||!auth.user)throw new Error('Reconnect and sign in to revoke sharing.');
 const {data:trip,error:readError}=await client.from('activities').select('id').eq('id',id).eq('owner_id',auth.user.id).maybeSingle();
 if(readError)throw new Error('Privacy could not be verified.');
 if(trip){const {error}=await client.rpc('revoke_activity_publication',{p_id:id});if(error)throw new Error('Sharing could not be revoked. Please retry.');}
 return {audience:'private'};
}
