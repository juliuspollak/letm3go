import { createClient } from 'npm:@supabase/supabase-js@2';
import { boundedJSON } from '../_shared/media.js';
import { withTeslaLease, saveTeslaCredentials, readTeslaCredentials, freshTeslaCredentials, teslaLocationAccess } from '../_shared/teslaCredentials.js';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
const digest=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const callback=(status:string)=>new Response(null,{status:302,headers:{Location:`au.jpollak.journey://tesla/connected?status=${status}`,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
Deno.serve(async request=>{
 if(request.method==='OPTIONS')return new Response(null,{headers});
 const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 const clientID=Deno.env.get('TESLA_CLIENT_ID'),secret=Deno.env.get('TESLA_CLIENT_SECRET'),redirect=Deno.env.get('TESLA_REDIRECT_URI'),audience=Deno.env.get('TESLA_FLEET_AUDIENCE'),encryption=Deno.env.get('ACCOUNT_CREDENTIAL_KEY');
 const allowed=['https://fleet-api.prd.na.vn.cloud.tesla.com','https://fleet-api.prd.eu.vn.cloud.tesla.com','https://fleet-api.prd.cn.vn.cloud.tesla.cn'];
 let redirectValid=false;try{const u=new URL(redirect!);redirectValid=u.protocol==='https:'&&!u.username&&!u.password&&!u.hash;}catch{/* Fail closed. */}
 let encryptionValid=false;try{encryptionValid=atob(encryption||'').length===32;}catch{/* Invalid key. */}
 const configured=!!(clientID&&secret&&redirectValid&&audience&&allowed.includes(audience)&&encryptionValid);
 const fleetApproved=Deno.env.get('TESLA_API_READS_APPROVED')==='true';
 try{
  const url=new URL(request.url);
  if(request.method==='GET'){
   if(!configured)return callback('setup_required');
   const state=url.searchParams.get('state');if(!state||state.length>200)return callback('invalid');
   const {data,error}=await admin.from('provider_oauth_states').delete().eq('state_hash',await digest(state)).gt('expires_at',new Date().toISOString()).select('owner_id').maybeSingle();
   if(error||!data)return callback('expired');
   const {data:deleting,error:deletionError}=await admin.from('account_deletion_requests').select('owner_id').eq('owner_id',data.owner_id).maybeSingle();if(deleting||deletionError)return callback('account_deleting');if(url.searchParams.has('error'))return callback('cancelled');
   const code=url.searchParams.get('code');if(!code||code.length>4000)return callback('invalid');
   return await withTeslaLease(admin,data.owner_id,async (lease:string)=>{
    const response=await fetch('https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:clientID!,client_secret:secret!,code,audience:audience!,redirect_uri:redirect!}),signal:AbortSignal.timeout(20000)});
    const tokens=await response.json();const seconds=Number(tokens.expires_in);if(!response.ok||!tokens.access_token||!tokens.refresh_token||!Number.isFinite(seconds)||seconds<=0)return callback('failed');
    const expires=Date.now()+seconds*1000;await saveTeslaCredentials(admin,data.owner_id,lease,{...tokens,expires_at:expires},encryption!);
    const {error:connected}=await admin.from('connected_services').upsert({owner_id:data.owner_id,provider:'tesla',status:'connected',expires_at:new Date(expires).toISOString()});
    return callback(connected?'failed':'connected');
   });
  }
  if(request.method!=='POST')return reply({error:'Unsupported method'},405);
  const caller=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:request.headers.get('Authorization')||''}},auth:{persistSession:false}});
  const {data,error}=await caller.auth.getUser();if(error||!data.user)return reply({error:'Sign in required'},401);
  const owner=data.user.id,body=await boundedJSON(request,10000);
  const {data:deleting,error:deletionError}=await admin.from('account_deletion_requests').select('owner_id').eq('owner_id',owner).maybeSingle();if(deleting||deletionError)return reply({error:'Account unavailable for Tesla operations'},409);
  const {data:budget}=await admin.rpc('consume_operation',{p_key:`tesla:${body.action==='status'?'status:':''}${owner}`,p_max:body.action==='status'?120:30});if(!budget)return reply({error:'Please retry later'},429);
  if(body.action==='status'){
   const {data:connection,error:connectionError}=await admin.from('connected_services').select('status,expires_at').eq('owner_id',owner).eq('provider','tesla').maybeSingle();if(connectionError)throw connectionError;
   const {error:schemaError}=await admin.from('tesla_token_leases').select('owner_id',{head:true}).limit(0);
   let locationAccess:boolean|null=null;
   if(configured&&connection?.status==='connected'){
    try{locationAccess=teslaLocationAccess(await readTeslaCredentials(admin,owner,encryption!));}catch{/* Missing or unreadable scopes must remain unverified; never infer consent. */}
   }
   const receiver=await admin.from('fleet_receiver_health').select('ready,last_seen').eq('id','primary').maybeSingle();
   const bindings=await admin.from('fleet_bindings').select('enabled,enabled_since,config_synced,last_received,error,location_verified').eq('owner_id',owner);
   const receiverReady=!receiver.error&&receiver.data?.ready===true&&Date.now()-Date.parse(receiver.data.last_seen)<120000;
   if(locationAccess===null&&(bindings.data||[]).some(b=>b.enabled&&b.location_verified))locationAccess=true;
   const recordingReady=receiverReady&&!bindings.error&&(bindings.data||[]).some(b=>b.enabled&&b.config_synced&&!b.error&&b.last_received&&Date.parse(b.last_received)>=Date.parse(b.enabled_since)&&Date.now()-Date.parse(b.last_received)<86400000);
   return reply({connectionReady:configured&&!schemaError,connected:connection?.status==='connected',status:connection?.status||'disconnected',locationAccess,vehicleSelectionReady:fleetApproved,automaticImportReady:recordingReady,importReason:recordingReady?'ready':receiverReady?'vehicle_setup_required':'telemetry_not_configured'});
  }
  if(!configured)return reply({code:'TESLA_SETUP_REQUIRED',error:'Tesla connection needs Letm3go server setup.'},503);
  if(body.action==='authorize'){
   await admin.from('provider_oauth_states').delete().lt('expires_at',new Date().toISOString());
   const state=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
   const {error}=await admin.from('provider_oauth_states').insert({state_hash:await digest(state),owner_id:owner});if(error)throw error;
   const oauth=new URL('https://auth.tesla.com/oauth2/v3/authorize');oauth.search=new URLSearchParams({response_type:'code',client_id:clientID!,redirect_uri:redirect!,scope:`openid offline_access vehicle_device_data${body.locationConsent===true?' vehicle_location':''}`,state}).toString();return reply({url:oauth.href});
  }
  if(body.action==='revokeConsent')return reply({url:`https://auth.tesla.com/user/revoke/consent?${new URLSearchParams({revoke_client_id:clientID!,back_url:redirect!})}`});
  if(body.action==='disconnect'){
   if(body.consentRevoked!==true)return reply({error:'Revoke Tesla consent first'},409);
   return await withTeslaLease(admin,owner,async (lease:string)=>{
    const existing=await readTeslaCredentials(admin,owner,encryption!);
    const checked=await fetch('https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:clientID!,refresh_token:existing.refresh_token}),signal:AbortSignal.timeout(20000)});
    const result=await checked.json();
    if(checked.ok){await saveTeslaCredentials(admin,owner,lease,{...existing,...result,expires_at:Date.now()+Number(result.expires_in)*1000},encryption!);return reply({error:'Tesla consent is still active. Complete revocation on Tesla’s page before disconnecting.'},409);}
    if(![400,401].includes(checked.status)||!['invalid_grant','login_required','invalid_token','invalid_refresh_token'].includes(result.error))return reply({error:'Unable to verify Tesla revocation. Connection retained; retry later.'},503);
    for(const table of ['provider_credentials','connected_services']){const {error}=await admin.from(table).delete().eq('owner_id',owner).eq('provider','tesla');if(error)throw error;}
    return reply({disconnected:true});
   });
  }
  if(!['vehicles','selectVehicles'].includes(body.action))return reply({error:'Unsupported action'},400);
  if(!fleetApproved)return reply({error:'Tesla vehicle discovery awaits operator billing approval.'},503);
  return await withTeslaLease(admin,owner,async (lease:string)=>{
   const credentials=await freshTeslaCredentials(admin,owner,lease,encryption!,clientID!);
   if(body.action==='vehicles'){
    const response=await fetch(`${audience}/api/1/vehicles`,{headers:{Authorization:`Bearer ${credentials.access_token}`},signal:AbortSignal.timeout(20000)});if(!response.ok)return reply({error:'Tesla vehicle retrieval failed'},502);
    const payload=await response.json();const vehicles=(payload.response||[]).map((v:{id_s:string;id:number;display_name:string;vin:string;granular_access?:{hide_private?:boolean}})=>({teslaID:v.id_s||String(v.id),name:v.display_name||'Tesla vehicle',vin:v.vin,hidePrivate:v.granular_access?.hide_private===true}));
    await saveTeslaCredentials(admin,owner,lease,{...credentials,vehicles},encryption!);return reply({vehicles});
   }
   const selected=Array.isArray(body.ids)?body.ids:[];if(!selected.length||selected.length>50||new Set(selected).size!==selected.length)return reply({error:'Choose up to 50 distinct vehicles'},400);
   const vehicles=(credentials.vehicles||[]).filter((v:{teslaID:string})=>selected.includes(v.teslaID)).map((v:{teslaID:string;name:string})=>({id:crypto.randomUUID(),owner_id:owner,name:v.name,make:'Tesla',model:'',tesla_vehicle_id:v.teslaID}));
   if(vehicles.length!==selected.length)return reply({error:'Select only vehicles returned for your own account'},400);
   const {error:saveError}=await admin.from('vehicles').upsert(vehicles,{onConflict:'owner_id,tesla_vehicle_id',ignoreDuplicates:true});if(saveError)throw saveError;
   const {data:stored,error:storedError}=await admin.from('vehicles').select('id,name,make,model,tesla_vehicle_id').eq('owner_id',owner).in('tesla_vehicle_id',selected);if(storedError||!stored||stored.length!==selected.length)throw storedError||new Error('Vehicle selection not persisted');return reply({vehicles:stored});
  });
 }catch(error){console.error('Tesla operation failed',error instanceof Error?error.name:'unknown');return request.method==='GET'?callback('failed'):reply({error:'Tesla operation could not be completed. Retry or reconnect your account.'},503);}
});
