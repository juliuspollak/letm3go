import { createClient } from 'npm:@supabase/supabase-js@2';
import { boundedJSON } from '../_shared/media.js';
import { openCredentials, sealCredentials } from '../_shared/credentialCrypto.js';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
const digest=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const callback=(status:string)=>new Response(null,{status:302,headers:{Location:`au.jpollak.journey://tesla/connected?status=${status}`,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
Deno.serve(async request=>{
 if(request.method==='OPTIONS')return new Response(null,{headers});
 const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 const clientID=Deno.env.get('TESLA_CLIENT_ID'),secret=Deno.env.get('TESLA_CLIENT_SECRET'),redirect=Deno.env.get('TESLA_REDIRECT_URI'),audience=Deno.env.get('TESLA_FLEET_AUDIENCE'),encryption=Deno.env.get('ACCOUNT_CREDENTIAL_KEY');
 const allowed=['https://fleet-api.prd.na.vn.cloud.tesla.com','https://fleet-api.prd.eu.vn.cloud.tesla.com','https://fleet-api.prd.cn.vn.cloud.tesla.cn'];
 if(!clientID||!secret||!redirect?.startsWith('https://')||!audience||!allowed.includes(audience)||!encryption)return reply({error:'Tesla operator configuration is incomplete'},503);
 try{
  const url=new URL(request.url);
  if(request.method==='GET'){
   const state=url.searchParams.get('state');if(!state||state.length>200)return callback('invalid');
   const {data,error}=await admin.from('provider_oauth_states').delete().eq('state_hash',await digest(state)).gt('expires_at',new Date().toISOString()).select('owner_id').maybeSingle();
   if(error||!data)return callback('expired');
   const {data:deleting,error:deletionError}=await admin.from('account_deletion_requests').select('owner_id').eq('owner_id',data.owner_id).maybeSingle();if(deleting||deletionError)return callback('account_deleting');if(url.searchParams.has('error'))return callback('cancelled');
   const code=url.searchParams.get('code');if(!code||code.length>4000)return callback('invalid');
   const response=await fetch('https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:clientID,client_secret:secret,code,audience,redirect_uri:redirect})});
   const tokens=await response.json();if(!response.ok||!tokens.access_token||!tokens.refresh_token)return callback('failed');
   const expires=Date.now()+Number(tokens.expires_in)*1000;
   const ciphertext=await sealCredentials({...tokens,expires_at:expires},encryption,data.owner_id,'tesla');
   const {error:saved}=await admin.from('provider_credentials').upsert({owner_id:data.owner_id,provider:'tesla',ciphertext});if(saved)return callback('failed');
   const {error:connected}=await admin.from('connected_services').upsert({owner_id:data.owner_id,provider:'tesla',status:'connected',expires_at:new Date(expires).toISOString()});
   return callback(connected?'failed':'connected');
  }
  if(request.method!=='POST')return reply({error:'Unsupported method'},405);
  const caller=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:request.headers.get('Authorization')||''}},auth:{persistSession:false}});
  const {data,error}=await caller.auth.getUser();if(error||!data.user)return reply({error:'Sign in required'},401);
  const owner=data.user.id,body=await boundedJSON(request,10000);
  const {data:budget}=await admin.rpc('consume_operation',{p_key:`tesla:${owner}`,p_max:30});if(!budget)return reply({error:'Please retry later'},429);
  if(body.action==='authorize'){
   const {data:deleting,error:deletionError}=await admin.from('account_deletion_requests').select('owner_id').eq('owner_id',owner).maybeSingle();if(deleting||deletionError)return reply({error:'Account unavailable for new connections'},409);
   await admin.from('provider_oauth_states').delete().lt('expires_at',new Date().toISOString());
   const state=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
   const {error}=await admin.from('provider_oauth_states').insert({state_hash:await digest(state),owner_id:owner});if(error)throw error;
   const oauth=new URL('https://auth.tesla.com/oauth2/v3/authorize');oauth.search=new URLSearchParams({response_type:'code',client_id:clientID,redirect_uri:redirect,scope:`openid offline_access vehicle_device_data${body.locationConsent===true?' vehicle_location':''}`,state}).toString();
   return reply({url:oauth.href});
  }
  if(body.action==='revokeConsent')return reply({url:`https://auth.tesla.com/user/revoke/consent?${new URLSearchParams({revoke_client_id:clientID,back_url:redirect}).toString()}`});
  if(body.action==='disconnect'){
   if(body.consentRevoked!==true)return reply({error:'Revoke Tesla consent first'},409);
   const {data:existing,error:readError}=await admin.from('provider_credentials').select('ciphertext').eq('owner_id',owner).eq('provider','tesla').maybeSingle();if(readError)throw readError;
   if(existing){
    const stored=await openCredentials(existing.ciphertext,encryption,owner,'tesla');
    const checked=await fetch('https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:clientID,refresh_token:stored.refresh_token})});
    const result=await checked.json();
    if(checked.ok){
     const ciphertext=await sealCredentials({...stored,...result,expires_at:Date.now()+Number(result.expires_in)*1000},encryption,owner,'tesla');
     const {error}=await admin.from('provider_credentials').upsert({owner_id:owner,provider:'tesla',ciphertext});if(error)throw error;
     return reply({error:'Tesla consent is still active. Complete revocation on Tesla’s consent page before disconnecting.'},409);
    }
    if(![400,401].includes(checked.status)||!['invalid_grant','login_required','invalid_token','invalid_refresh_token'].includes(result.error))return reply({error:'Unable to verify Tesla revocation. Connection retained; retry later.'},503);
   }
   const {error:removed}=await admin.from('provider_credentials').delete().eq('owner_id',owner).eq('provider','tesla');if(removed)throw removed;
   const {error:disconnected}=await admin.from('connected_services').delete().eq('owner_id',owner).eq('provider','tesla');if(disconnected)throw disconnected;
   return reply({disconnected:true});
  }
  if(!['vehicles','selectVehicles'].includes(body.action))return reply({error:'Unsupported action'},400);
  if(Deno.env.get('TESLA_API_READS_APPROVED')!=='true')return reply({error:'Fleet API vehicle reads need operator approval and billing review'},503);
  const {data:row,error:rowError}=await admin.from('provider_credentials').select('ciphertext').eq('owner_id',owner).eq('provider','tesla').maybeSingle();if(rowError||!row)return reply({error:'Connect your own Tesla account first'},404);
  const credentials=await openCredentials(row.ciphertext,encryption,owner,'tesla');
  if(credentials.expires_at<Date.now())return reply({error:'Tesla access expired. Reconnect; automatic refresh is not enabled in this milestone.'},409);
  if(body.action==='vehicles'){
   const response=await fetch(`${audience}/api/1/vehicles`,{headers:{Authorization:`Bearer ${credentials.access_token}`}});if(!response.ok)return reply({error:'Tesla vehicle retrieval failed'},502);
   const payload=await response.json();
   const vehicles=(payload.response||[]).map((vehicle:{id_s:string;id:number;display_name:string})=>({teslaID:vehicle.id_s||String(vehicle.id),name:vehicle.display_name||'Tesla vehicle'}));
   const ciphertext=await sealCredentials({...credentials,vehicles},encryption,owner,'tesla');await admin.from('provider_credentials').upsert({owner_id:owner,provider:'tesla',ciphertext});return reply({vehicles});
  }
  const selected=Array.isArray(body.ids)?body.ids:[];
  const vehicles=(credentials.vehicles||[]).filter((vehicle:{teslaID:string})=>selected.includes(vehicle.teslaID)).map((vehicle:{teslaID:string;name:string})=>({id:crypto.randomUUID(),owner_id:owner,name:vehicle.name,make:'Tesla',model:'',tesla_vehicle_id:vehicle.teslaID}));
  if(!vehicles.length||vehicles.length!==selected.length)return reply({error:'Select only vehicles returned for your own account'},400);
  const {error:saveError}=await admin.from('vehicles').insert(vehicles);if(saveError)throw saveError;
  return reply({vehicles:vehicles.map(({id,name,make,model}:{id:string;name:string;make:string;model:string})=>({id,name,make,model}))});
 }catch(error){console.error('Tesla operation failed',error instanceof Error?error.name:'unknown');return reply({error:'Tesla operation could not be completed'},500);}
});
