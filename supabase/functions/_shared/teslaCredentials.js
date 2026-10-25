import { openCredentials, sealCredentials } from './credentialCrypto.js';
export async function withTeslaLease(admin,owner,operation){
 const {data:lease,error}=await admin.rpc('acquire_tesla_token_lease',{p_owner:owner});
 if(error)throw new Error('Tesla credential storage needs its approved backend migration.');
 if(!lease)throw new Error('Another Tesla operation is in progress. Please retry shortly.');
 try{return await operation(lease);}finally{const {error}=await admin.rpc('release_tesla_token_lease',{p_owner:owner,p_lease:lease});if(error)console.error('Tesla credential lease release deferred until expiry');}
}
export async function saveTeslaCredentials(admin,owner,lease,value,key,cryptoImpl=crypto){
 const ciphertext=await sealCredentials(value,key,owner,'tesla',cryptoImpl);
 const {error}=await admin.rpc('save_tesla_credentials',{p_owner:owner,p_lease:lease,p_ciphertext:ciphertext});
 if(error)throw new Error('Tesla credentials could not be saved. Reconnect before retrying.');
}
export async function readTeslaCredentials(admin,owner,key,cryptoImpl=crypto){
 const {data,error}=await admin.from('provider_credentials').select('ciphertext').eq('owner_id',owner).eq('provider','tesla').maybeSingle();
 if(error||!data)throw new Error('Connect your own Tesla account first.');
 return openCredentials(data.ciphertext,key,owner,'tesla',cryptoImpl);
}
// Call only while holding the owner's lease. Save rotated tokens before any Fleet call.
export async function freshTeslaCredentials(admin,owner,lease,key,clientID,{fetchImpl=fetch,cryptoImpl=crypto,now=Date.now()}={}){
 const stored=await readTeslaCredentials(admin,owner,key,cryptoImpl);
 if(Number.isFinite(stored.expires_at)&&stored.expires_at>now+60000)return stored;
 if(!stored.refresh_token)throw new Error('Reconnect Tesla to renew access.');
 const response=await fetchImpl('https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:clientID,refresh_token:stored.refresh_token}),signal:AbortSignal.timeout(20000)});
 const tokens=await response.json();
 if(!response.ok||!tokens.access_token||!tokens.refresh_token||!Number.isFinite(Number(tokens.expires_in))||Number(tokens.expires_in)<=0)throw new Error('Tesla access could not be renewed. Reconnect your Tesla account.');
 const refreshed={...stored,...tokens,expires_at:now+Number(tokens.expires_in)*1000};
 await saveTeslaCredentials(admin,owner,lease,refreshed,key,cryptoImpl);
 return refreshed;
}

// Report only scopes actually returned by Tesla, never the requested consent flag.
export function teslaLocationAccess(credentials){
 if(typeof credentials?.scope!=='string'||!credentials.scope.trim())return null;
 return credentials.scope.trim().split(/\s+/).includes('vehicle_location');
}
