import { syncPrivateActivities } from './cloudSync.js';
export async function sharingRequest(client,action,id,params={}){
 if(!client)throw new Error('Sign in while online to change privacy.');
 const {data:auth,error:authError}=await client.auth.getUser();if(authError||!auth.user)throw new Error('Sign in while online to change privacy.');
 const {data,error}=await client.functions.invoke('journeys',{body:{action,id,...params},timeout:20000});
 if(error||data?.error||!data)throw new Error('Sharing could not be confirmed. The journeys backend may need deployment. Your last confirmed permission has not been changed in this screen.');
 return data;
}
export async function publishActivity({client,state,id,receipts,checkpoint,reviewedTrip,signal,audience='public',mode=null,recipients=[],photoIDs=[]}){
 if(!['public','friends','household'].includes(audience))throw new Error('Choose a supported audience.');
 if(audience!=='public' && !((audience==='friends'&&['friends','selected'].includes(mode))||(audience==='household'&&mode==='household')))throw new Error('The sharing audience needs review.');
 if(!Array.isArray(photoIDs)||photoIDs.length>50||photoIDs.some(p=>typeof p!=='string'))throw new Error('Invalid photo selection.');
 const {data:auth,error}=await client.auth.getUser();const owner=auth?.user?.id;
 if(error||!owner||state.ownerID?.toLowerCase()!==owner.toLowerCase())throw new Error('This activity belongs to a different account.');
 const trip=state.trips.find(t=>t.id===id);if(!trip||trip.source!=='device'||!trip.endedAt)throw new Error('Only completed iPhone activities can be shared.');
 if(reviewedTrip&&(JSON.stringify(trip.points)!==JSON.stringify(reviewedTrip.points)||trip.activity!==reviewedTrip.activity||(trip.details?.description||'')!==(reviewedTrip.description||'')))throw new Error('Activity changed. Close privacy controls and review the latest activity before publishing.');
 const backup=await syncPrivateActivities(client,{...state,trips:[trip],deletedIDs:[]},receipts,{checkpoint});
 const {data:current,error:readError}=await client.from('activities').select('revision').eq('id',id).eq('owner_id',owner).single();
 if(readError||!Number.isInteger(current?.revision))throw new Error('The current activity could not be verified.');
 const {data:again,error:accountError}=await client.auth.getUser();if(accountError||again.user?.id!==owner)throw new Error('Account changed. Publication cancelled.');
 // Last point at which leaving can still stop the activity going public.
 if(signal?.aborted)throw new Error('Publication cancelled.');
 // Closing an earlier social policy before re-publication fails closed: an old
 // recipient must never see a new route while its permissions are being replaced.
 if(audience!=='public'){
  const {error:prepareError}=await client.rpc('prepare_social_journey',{p_activity:id});
  if(prepareError&&!/Only the owner/.test(prepareError.message||'')){
   // A first-time publication has no row yet, so prepare is not required.
   const {data:previous}=await client.from('activities').select('id').eq('id',id).eq('owner_id',owner).maybeSingle();
   if(!previous)throw new Error('The activity must be backed up before sharing.');
   // No safe way to distinguish a missing migration from an ownership failure.
   throw new Error('Private sharing is not configured. Nothing was published.');
  }
 }
 const result=await sharingRequest(client,'publish',id,{audience,revision:current.revision,placesConfirmed:true,photoIDs});
 if(!result.token)throw new Error('Publication was not confirmed.');
 if(audience!=='public'){
  const {error:accessError}=await client.rpc('configure_social_journey',{p_activity:id,p_mode:mode,p_recipients:mode==='selected'?recipients:[]});
  if(accessError){
   // A social publication without a policy cannot be read. Revoke nevertheless,
   // so a later migration cannot accidentally expose the incomplete publication.
   await client.rpc('revoke_activity_publication',{p_id:id}).catch(()=>{});
   throw new Error('Social recipients could not be confirmed. The journey was not shared.');
  }
 }
 return {...result,receipts:backup.receipts};
}
export async function makeActivityPrivate(client,id){
 const {data:auth,error}=await client.auth.getUser();if(error||!auth.user)throw new Error('Reconnect and sign in to revoke sharing.');
 const {data:trip,error:readError}=await client.from('activities').select('id').eq('id',id).eq('owner_id',auth.user.id).maybeSingle();
 if(readError)throw new Error('Privacy could not be verified.');
 if(trip){const {error}=await client.rpc('revoke_activity_publication',{p_id:id});if(error)throw new Error('Sharing could not be revoked. Please retry.');}
 return {audience:'private'};
}
