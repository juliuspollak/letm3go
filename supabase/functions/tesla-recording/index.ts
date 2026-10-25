import {createClient} from 'npm:@supabase/supabase-js@2';
import {boundedJSON} from '../_shared/media.js';
import {withTeslaLease,freshTeslaCredentials,teslaLocationAccess} from '../_shared/teslaCredentials.js';
import {compatibility,pairingURL,FLEET_FIELDS,automaticRecordingStatus} from '../_shared/fleetTelemetry.js';
const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info'};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async request=>{
 if(request.method==='OPTIONS')return new Response(null,{headers});if(request.method!=='POST')return reply({error:'Unsupported method'},405);
 try{
  const caller=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:request.headers.get('Authorization')||''}},auth:{persistSession:false}});
  const {data:identity,error:authError}=await caller.auth.getUser();if(authError||!identity.user)return reply({error:'Sign in required'},401);
  const owner=identity.user.id,body=await boundedJSON(request,10000);
  const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  const {data:deleting,error:deletingError}=await admin.from('account_deletion_requests').select('owner_id').eq('owner_id',owner).maybeSingle();if(deleting||deletingError)return reply({error:'Account unavailable'},409);
  if(['feed','status'].includes(body.action)){const limited=await admin.rpc('consume_operation',{p_key:`fleet-ui:${owner}`,p_max:120});if(limited.error||!limited.data)return reply({error:'Please wait before retrying vehicle sync.'},429);}
  if(body.action==='feed'){
   const {data,error}=await caller.from('activities').select('*').eq('recording_mode','tesla').lt('started_at',body.before||new Date().toISOString()).order('started_at',{ascending:false}).limit(10);if(error)throw error;
   const charges=await caller.from('fleet_charging_stops').select('*').gte('ended_at',new Date(Date.now()-7*86400000).toISOString()).limit(1000);if(charges.error)throw charges.error;
   const quality=data.length?await caller.from('fleet_segments').select('activity_id,incomplete').in('activity_id',data.map(v=>v.id)):{data:[],error:null};if(quality.error)throw quality.error;
   const vehicleIDs=[...new Set(data.map(v=>v.vehicle_id).filter(Boolean))];const aliases=vehicleIDs.length?await admin.from('vehicles').select('id,tesla_vehicle_id').in('id',vehicleIDs):{data:[],error:null};if(aliases.error)throw aliases.error;
   return reply({activities:data.map(row=>({...row,telemetry_incomplete:quality.data?.find(s=>s.activity_id===row.id)?.incomplete,provider_vehicle_id:aliases.data?.find(v=>v.id===row.vehicle_id)?.tesla_vehicle_id})),charges:charges.data,next:data.length===10?data.at(-1).started_at:null});
  }
  const vehicleID=body.vehicleID;if(typeof vehicleID!=='string'||! /^[a-f0-9-]{36}$/i.test(vehicleID))return reply({error:'Choose an imported Tesla vehicle'},400);
  const {data:vehicle,error:vehicleError}=await admin.from('vehicles').select('id,name,tesla_vehicle_id').eq('id',vehicleID).eq('owner_id',owner).maybeSingle();if(vehicleError||!vehicle)return reply({error:'Your imported Tesla vehicle was not found'},404);
  const binding=await admin.from('fleet_bindings').select('*').eq('vehicle_id',vehicleID).eq('owner_id',owner).maybeSingle();
  if(binding.error)return reply({error:'Telemetry database setup is required'},503);
  const health=await admin.from('fleet_receiver_health').select('*').eq('id','primary').maybeSingle();
  const state=binding.data;
  if(body.action==='status')return reply({setting:state?{enabled:state.enabled,enabledSince:state.enabled_since,configSynced:state.config_synced,keyPaired:state.key_paired,keyRequired:state.key_required,lastReceived:state.last_received,streamConnected:state.stream_connected,error:state.error,sharingHousehold:!!state.household_id}:null,...automaticRecordingStatus(state,health.data),setupReady:!!Deno.env.get('FLEET_RECEIVER_HOST')&&health.data?.ready===true});
  if(!['check','enable','disable','pairingLink','shareHousehold'].includes(body.action))return reply({error:'Unsupported recording action'},400);
  if(body.action==='shareHousehold'){
   if(!state)return reply({error:'Configure this vehicle first'},409);
   let household=null;if(body.enabled===true){if(body.consent!==true)return reply({error:'Explicit household sharing consent required'},400);const membership=await admin.from('household_memberships').select('household_id').eq('user_id',owner).maybeSingle();if(membership.error||!membership.data)return reply({error:'Join a household first'},409);household=membership.data.household_id;}
   const saved=await admin.from('fleet_bindings').update({household_id:household,share_from:household?new Date().toISOString():null}).eq('vehicle_id',vehicleID).eq('owner_id',owner);if(saved.error)throw saved.error;return reply({saved:true});
  }
  if(body.action==='disable'){
   // Stop accepting data immediately even if the remote deletion cannot complete.
   const stopped=await admin.from('fleet_bindings').update({enabled:false,error:'Recording disabled; vehicle streaming removal pending and may still incur charges'}).eq('vehicle_id',vehicleID).eq('owner_id',owner);if(stopped.error)throw stopped.error;
  }
  if(Deno.env.get('FLEET_VEHICLE_SETUP_APPROVED')!=='true')return reply({error:body.action==='disable'?'Recording stopped locally; operator approval is required to remove the vehicle configuration.':'Telemetry setup awaits operator infrastructure and billing approval.'},503);
  const budget=await admin.rpc('consume_operation',{p_key:`fleet-setup:${owner}:${vehicleID}`,p_max:5});if(budget.error||!budget.data)return reply({error:'Setup limit reached. Wait before retrying.'},429);
  const key=Deno.env.get('ACCOUNT_CREDENTIAL_KEY')!,clientID=Deno.env.get('TESLA_CLIENT_ID')!,audience=Deno.env.get('TESLA_FLEET_AUDIENCE')!;
  if(!['https://fleet-api.prd.na.vn.cloud.tesla.com','https://fleet-api.prd.eu.vn.cloud.tesla.com'].includes(audience))return reply({error:'Supported Fleet region must be configured'},503);
  return await withTeslaLease(admin,owner,async(lease:string)=>{
   const credentials=await freshTeslaCredentials(admin,owner,lease,key,clientID);
   const selected=(credentials.vehicles||[]).find((v:{teslaID:string;vin?:string;hidePrivate?:boolean})=>v.teslaID===vehicle.tesla_vehicle_id);
   if(!selected?.vin)return reply({error:'Refresh Tesla vehicle discovery once to verify this vehicle identity.'},409);
   const vin=selected.vin;
   const registered=await admin.from('fleet_bindings').select('owner_id,vehicle_id').eq('vin',vin).maybeSingle();if(registered.error)throw registered.error;
   if(registered.data&&(registered.data.owner_id!==owner||registered.data.vehicle_id!==vehicleID))return reply({error:'This vehicle already has a recording owner. Use the explicitly shared household feed.'},409);

   if(body.action==='pairingLink')return reply({url:pairingURL(vin)});
   if(teslaLocationAccess(credentials)===false||selected.hidePrivate===true)return reply({error:'Tesla has not granted location access for this vehicle.'},403);
   const fleet=async(path:string,options:RequestInit={})=>{
    const response=await fetch(audience+path,{...options,headers:{Authorization:`Bearer ${credentials.access_token}`,'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(20000)});
    if(response.status===403||response.status===402)await admin.from('fleet_bindings').update({enabled:false,error:response.status===403?'Tesla location permission revoked':'Tesla billing limit reached'}).eq('owner_id',owner).eq('vehicle_id',vehicleID);
    if(!response.ok)throw new Error(response.status===429?'Tesla rate limit reached; retry later':response.status===402?'Tesla billing limit reached':response.status===403?'Tesla permission was revoked':'Tesla is unavailable or the vehicle may be asleep. No wake request was sent.');
    return response.json();
   };
   const fleetStatus=(await fleet('/api/1/vehicles/fleet_status',{method:'POST',body:JSON.stringify({vins:[vin]})})).response;
   const info={...fleetStatus?.vehicle_info?.[vin],key_paired:fleetStatus?.key_paired_vins?.includes(vin)===true};const support=compatibility(info);
   if(body.action==='check'){
    const config=(await fleet(`/api/1/vehicles/${vin}/fleet_telemetry_config`)).response;
    const synced=config?.synced===true&&(config?.config||config)?.hostname===Deno.env.get('FLEET_RECEIVER_HOST');
    const saved=await admin.from('fleet_bindings').upsert({vin,vehicle_id:vehicleID,owner_id:owner,key_paired:info.key_paired,key_required:support.keyRequired??true,config_synced:synced,enabled:!!state?.enabled&&synced,enabled_since:state?.enabled_since||null,error:support.ready?null:support.reason},{onConflict:'vin'});if(saved.error)throw saved.error;
    return reply({compatibility:support,configSynced:config?.synced===true,pairingURL:pairingURL(vin)});
   }
   if(body.action==='enable'&&body.consent!==true)return reply({error:'Confirm future vehicle location recording'},400);
   if(body.action==='enable'&&!support.ready)return reply({error:support.reason,pairingURL:pairingURL(vin)},409);
   const host=Deno.env.get('FLEET_RECEIVER_HOST'),ca=Deno.env.get('FLEET_RECEIVER_CA'),control=Deno.env.get('FLEET_CONTROL_URL'),secret=Deno.env.get('FLEET_CONTROL_SECRET');
   if(!host||!ca||!control?.startsWith('https://')||!secret||secret.length<32)return reply({error:'Receiver and signing service configuration missing'},503);
   const destination=new URL(control);if(destination.hostname!==host||destination.port!=='8443'||destination.pathname!=='/configure'||destination.username||destination.password||destination.hash||destination.search)return reply({error:'Signing gateway must match the approved receiver host'},503);
   if(body.action==='enable'&&(!health.data?.ready||Date.now()-Date.parse(health.data.last_seen)>120000))return reply({error:'The receiver is not healthy. Recording was not enabled.'},503);
   const actionBody=JSON.stringify({action:body.action==='enable'?'configure':'delete',vin,accessToken:credentials.access_token,config:{hostname:host,port:443,ca,fields:FLEET_FIELDS}}),time=String(Date.now());
   const signingKey=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
   const signature=[...new Uint8Array(await crypto.subtle.sign('HMAC',signingKey,new TextEncoder().encode(`${time}.${actionBody}`)))].map(n=>n.toString(16).padStart(2,'0')).join('');
   const response=await fetch(control,{method:'POST',headers:{'Content-Type':'application/json','x-lmg-time':time,'x-lmg-signature':signature},body:actionBody,redirect:'error',signal:AbortSignal.timeout(30000)});
   if(!response.ok)return reply({error:'Signed telemetry configuration failed. Check pairing, firmware and receiver setup.'},503);
   if(body.action==='disable'){await admin.from('fleet_bindings').update({error:null,config_synced:false}).eq('vehicle_id',vehicleID).eq('owner_id',owner);return reply({disabled:true});}
   const config=(await fleet(`/api/1/vehicles/${vin}/fleet_telemetry_config`)).response;
   const synced=config?.synced===true&&(config?.config||config)?.hostname===host;
   const existing=await admin.from('fleet_bindings').select('owner_id,vehicle_id').eq('vin',vin).maybeSingle();if(existing.error)throw existing.error;
   if(existing.data&&(existing.data.owner_id!==owner||existing.data.vehicle_id!==vehicleID))return reply({error:'This vehicle already has a recording owner. Use its explicitly shared household journey feed.'},409);
   const saved=await admin.from('fleet_bindings').upsert({vin,vehicle_id:vehicleID,owner_id:owner,enabled:synced,enabled_since:state?.enabled?state.enabled_since:new Date().toISOString(),last_received:state?.enabled?state.last_received:null,stream_connected:state?.enabled?state.stream_connected:null,location_verified:state?.enabled?state.location_verified:false,config_synced:synced,key_paired:info.key_paired,key_required:support.keyRequired??true,error:synced?null:'Waiting for the vehicle to adopt the configuration'},{onConflict:'vin'});if(saved.error)throw saved.error;
   return reply({configured:true,enabled:synced,message:synced?'Configured. Recording begins with future telemetry.':'Configuration sent. Let the vehicle connect, then check setup again before enabling.'});
  });
 }catch(error){return reply({error:error instanceof Error&&/^(Tesla|Setup)/.test(error.message)?error.message:'Vehicle recording could not be updated. Retry later.'},503);}
});
