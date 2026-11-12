import { syncPrivateActivities } from './cloudSync.js';
export async function sharingRequest(client,action,id,params={}){
 if(!client)throw new Error('Sign in while online to change privacy.');
 const {data:auth,error:authError}=await client.auth.getUser();if(authError||!auth.user)throw new Error('Sign in while online to change privacy.');
 const {data,error}=await client.functions.invoke('journeys',{body:{action,id,...params},timeout:20000});
 if(error||data?.error||!data)throw new Error('Sharing could not be confirmed. The journeys backend may need deployment. Your last confirmed permission has not been changed in this screen.');
 return data;
}
export async function publishActivity({client,state,id,receipts,checkpoint,reviewedTrip,signal,audience='public',mode=null,recipients=[],photoIDs=[],auto=false}){
 if(!['public','friends','household'].includes(audience))throw new Error('Choose a supported audience.');
 if(audience!=='public' && !((audience==='friends'&&['friends','selected','mixed','all'].includes(mode))||(audience==='household'&&mode==='household')))throw new Error('The sharing audience needs review.');
 if(!Array.isArray(photoIDs)||photoIDs.length>50||photoIDs.some(p=>typeof p!=='string'))throw new Error('Invalid photo selection.');
 const {data:auth,error}=await client.auth.getUser();const owner=auth?.user?.id;
 if(error||!owner||state.ownerID?.toLowerCase()!==owner.toLowerCase())throw new Error('This activity belongs to a different account.');
 const trip=state.trips.find(t=>t.id===id);if(!trip||!['device','watch'].includes(trip.source)||!trip.endedAt)throw new Error('Only completed recordings from this account can be shared.');
 if(reviewedTrip&&(JSON.stringify(trip.points)!==JSON.stringify(reviewedTrip.points)||trip.activity!==reviewedTrip.activity||(trip.details?.description||'')!==(reviewedTrip.description||'')))throw new Error('Activity changed. Close privacy controls and review the latest activity before publishing.');
 // Anyone else sees a masked route, so Home must be known; a household already knows where Home is, so it is not required for them.
 if(!(audience==='household'&&mode==='household')&&!state.places?.some(p=>p.kind==='home'&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)))throw new Error('Set your Home place before sharing a GPS activity so the private route can be masked.');
 const backup=await syncPrivateActivities(client,{...state,trips:[trip],deletedIDs:[]},receipts,{checkpoint});
 const {data:current,error:readError}=await client.from('activities').select('revision').eq('id',id).eq('owner_id',owner).single();
 if(readError||!Number.isInteger(current?.revision))throw new Error('The current activity could not be verified.');
 const {data:again,error:accountError}=await client.auth.getUser();if(accountError||again.user?.id!==owner)throw new Error('Account changed. Publication cancelled.');
 // Last point at which leaving can still stop the activity going public.
 if(signal?.aborted)throw new Error('Publication cancelled.');
 const result=await sharingRequest(client,'publish',id,{
  audience,revision:current.revision,placesConfirmed:true,photoIDs,...(auto?{auto:true}:{}),
  ...(audience==='public'?{}:{mode,recipients:['selected','mixed'].includes(mode)?recipients:[]})
 });
 if(!result.token)throw new Error('Publication was not confirmed.');
 return {...result,receipts:backup.receipts};
}
export async function makeActivityPrivate(client,id){
 const {data:auth,error}=await client.auth.getUser();if(error||!auth.user)throw new Error('Reconnect and sign in to revoke sharing.');
 const {data:trip,error:readError}=await client.from('activities').select('id').eq('id',id).eq('owner_id',auth.user.id).maybeSingle();
 if(readError)throw new Error('Privacy could not be verified.');
 if(trip){const {error}=await client.rpc('revoke_activity_publication',{p_id:id});if(error)throw new Error('Sharing could not be revoked. Please retry.');}
 // The owner's decision for this activity, recorded whether or not it has been uploaded
 // yet, so automatic sharing never publishes it later. Two records: by activity (once it
 // exists in the cloud) and by the recorder's own id (works before it is uploaded).
 // supabase-js reports a failure as {error}, not an exception. A server that does not have
 // the functions yet is fine; any other failure must not look like success. Retrying is safe.
 // Only "this function is not deployed" counts as missing; any other error (including a table or
 // column that does not exist because a migration is half applied) must not be waved through.
 const missing=e=>/^(PGRST202|42883)$/.test(String(e.code||''))||/could not find the function/i.test(e.message||'');
 const calls=[client.rpc('end_live_trail',{p_ref:String(id),p_hide:true})];
 if(trip)calls.push(client.rpc('keep_activity_private',{p_activity:id}));
 for(const result of await Promise.all(calls)){
  if(result?.error&&!missing(result.error))throw new Error('The activity is private, but that choice could not be saved. Please retry.');
 }
 return {audience:'private'};
}
