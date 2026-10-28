export const isTransientAuthError=error=>!error?.status||error.status===429||error.status>=500||error.name==='AuthRetryableFetchError';
// Revoked or mismatched identity: the account must be signed out of the recorder.
// Anything else (offline, timeout, native bridge failure) only locks the interface.
export const definitiveIdentityFailure=error=>error?.status===401||error?.status===403||/mismatch|did not match/i.test(error?.message||'');
export async function resolveIdentity({client,session,store,apiKey,isCurrent=()=>true,offlineOnly=false}){
 if(!session?.user?.id||!session.access_token)return {status:'signedOut',session:null};
 let user,offline=false;
 try{if(offlineOnly)throw Object.assign(new Error('Offline restoration'),{name:'AuthRetryableFetchError'});const result=await Promise.race([client.auth.getUser(session.access_token),new Promise((_,reject)=>setTimeout(()=>reject(Object.assign(new Error('Identity verification timed out'),{name:'AuthRetryableFetchError'})),6000))]);if(result.error)throw result.error;user=result.data.user;if(!user||user.id!==session.user.id)throw Object.assign(new Error('Session identity mismatch'),{status:401});}
 catch(error){if(!isTransientAuthError(error))throw error;user=session.user;offline=true;}
 if(!user.email_confirmed_at) return {status:'verification',session:{...session,user}};
 if(!isCurrent())throw new Error('Authentication changed.');
 const local=await store.bind({...session,user},apiKey,{offline});
 if(local.ownerID?.toLowerCase()!==user.id.toLowerCase())throw new Error('Private account storage did not match this session.');
 return {status:user.app_metadata?.deletion_requested?'deletionPending':offline?'offline':'authenticated',session:{...session,user},preferences:local.preferences};
}
