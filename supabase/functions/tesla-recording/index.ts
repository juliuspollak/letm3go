import {createClient} from 'npm:@supabase/supabase-js@2';
import {boundedJSON} from '../_shared/media.js';
import {withTeslaLease,freshTeslaCredentials,teslaLocationAccess} from '../_shared/teslaCredentials.js';
import {compatibility,pairingURL,FLEET_FIELDS,automaticRecordingStatus,receiverIsReady,checkedFleetConfiguration,fleetConfigurationRemoved,CONFIGURATION_PENDING,REMOVAL_PENDING} from '../_shared/fleetTelemetry.js';
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
  const {data:vehicle,error:vehicleError}=await admin.from('vehicles').select('id,name,tesla_vehicle_id').eq('id',vehicleID).eq('owner_id',owner).maybeSingle();if(vehicleError||!vehicle?.tesla_vehicle_id)return reply({error:'Your imported Tesla vehicle was not found'},404);
  const bindings=()=>admin.from('fleet_bindings').select('*').eq('vehicle_id',vehicleID).eq('owner_id',owner);
  const [binding,health]=await Promise.all([
   bindings().maybeSingle(),admin.from('fleet_receiver_health').select('*').eq('id','primary').maybeSingle()
  ]);
  if(binding.error||(health.error&&body.action!=='disable'))return reply({error:'Telemetry database status could not be checked.'},503);
  const host=Deno.env.get('FLEET_RECEIVER_HOST'),ca=Deno.env.get('FLEET_RECEIVER_CA'),secret=Deno.env.get('FLEET_CONTROL_SECRET');
  let control: URL | undefined;
  try{const url=Deno.env.get('FLEET_CONTROL_URL');if(url)control=new URL(url);}catch{/* Invalid operator configuration. */}
  const configured=!!(host&&ca?.includes('BEGIN CERTIFICATE')&&secret&&secret.length>=32&&control?.protocol==='https:'&&control.hostname===host&&control.port==='8443'&&control.pathname==='/configure'&&!control.username&&!control.password&&!control.hash&&!control.search);
  const audience=Deno.env.get('TESLA_FLEET_AUDIENCE')||'';
  const supportedRegion=['https://fleet-api.prd.na.vn.cloud.tesla.com','https://fleet-api.prd.eu.vn.cloud.tesla.com'].includes(audience);
  const credentialKey=Deno.env.get('ACCOUNT_CREDENTIAL_KEY'),clientID=Deno.env.get('TESLA_CLIENT_ID');
  const approved=Deno.env.get('FLEET_VEHICLE_SETUP_APPROVED')==='true';
  const ready=receiverIsReady(health.data);
  if(body.action==='status'){
   const {data:connection,error}=await admin.from('connected_services').select('status').eq('owner_id',owner).eq('provider','tesla').maybeSingle();
   if(error)return reply({error:'Tesla account status could not be checked.'},503);
   const accountConnected=connection?.status==='connected';
   const state=binding.data;
   const canSetup=accountConnected&&configured&&approved&&ready&&supportedRegion&&!!credentialKey&&!!clientID;
   const pending=state?.error===CONFIGURATION_PENDING,removing=state?.error===REMOVAL_PENDING;
   const status=accountConnected?automaticRecordingStatus(state,health.data):
    {code:'account_disconnected',active:false,label:'Tesla account disconnected'};
   return reply({...status,accountConnected,vehicleImported:true,receiverReady:ready,
    reason:!accountConnected?'Connect Tesla in My Collection.':!configured?'Letm3go must configure the telemetry receiver and signing gateway.':!approved?'Vehicle setup is awaiting operator approval.':!supportedRegion||!credentialKey||!clientID?'Letm3go must verify the Tesla region and credential settings.':!ready?'Retry when the telemetry receiver is online.':null,
    actions:{check:canSetup,pair:canSetup&&state?.key_required===true&&state?.key_paired===false&&!removing,
     enable:canSetup&&!!state&&!state.enabled&&!state.error,
     disable:!!(state?.enabled||pending||removing||state?.config_synced)},
    setting:state?{enabled:state.enabled,enabledSince:state.enabled?state.enabled_since:null,configSynced:state.config_synced,keyPaired:state.key_paired,keyRequired:state.key_required,lastReceived:state.last_received,streamConnected:state.stream_connected,error:state.error,sharingHousehold:!!state.household_id}:null});
  }
  if(!['check','enable','disable','pairingLink','shareHousehold'].includes(body.action))return reply({error:'Unsupported recording action'},400);
  const update=(values:Record<string,unknown>)=>admin.from('fleet_bindings').update(values).eq('vehicle_id',vehicleID).eq('owner_id',owner);
  if(body.action==='shareHousehold'){
   if(!binding.data)return reply({error:'Configure this vehicle first'},409);
   let household=null;
   if(body.enabled===true){
    if(body.consent!==true)return reply({error:'Explicit household sharing consent required'},400);
    const membership=await admin.from('household_memberships').select('household_id').eq('user_id',owner).maybeSingle();
    if(membership.error||!membership.data)return reply({error:'Join a household first'},409);
    household=membership.data.household_id;
   }
   const saved=await update({household_id:household,share_from:household?new Date().toISOString():null});
   if(saved.error)throw saved.error;
   return reply({saved:true});
  }
  const disabling=body.action==='disable';
  return await withTeslaLease(admin,owner,async(lease:string)=>{
   const latest=await bindings().maybeSingle();if(latest.error)throw latest.error;
   const state=latest.data;
   if(disabling){
    if(!state)return reply({disabled:true});
    const stopped=await update({enabled:false,enabled_since:null,error:REMOVAL_PENDING});
    if(stopped.error)throw stopped.error;
   }
   if(!approved||!configured||(!disabling&&!receiverIsReady(health.data)))
    return reply({error:disabling?'Recording stopped in Letm3go. Vehicle streaming removal is pending until the signing gateway is available.':'Vehicle setup requires operator approval, a signing gateway and a healthy receiver.'},503);
   if(!supportedRegion||!credentialKey||!clientID)return reply({error:'Tesla region and credential settings must be configured.'},503);
   if(body.action==='enable'&&body.consent!==true)return reply({error:'Confirm future vehicle location recording'},400);
   if(body.action==='enable'&&(state?.enabled||state?.error===CONFIGURATION_PENDING||state?.error===REMOVAL_PENDING))
    return reply({error:'Check the current configuration or finish removal before enabling again.'},409);
   const budget=await admin.rpc('consume_operation',{p_key:`fleet-setup:${owner}:${vehicleID}`,p_max:5});
   if(budget.error||!budget.data)return reply({error:'Setup limit reached. Wait before retrying.'},429);
   const credentials=await freshTeslaCredentials(admin,owner,lease,credentialKey,clientID);
   const selected=(credentials.vehicles||[]).find((v:{teslaID:string;vin?:string;hidePrivate?:boolean})=>v.teslaID===vehicle.tesla_vehicle_id);
   const vin=disabling?state?.vin:selected?.vin;
   if(!vin)return reply({error:'Refresh Tesla vehicle discovery in My Collection, then retry.'},409);
   if(state&&state.vin!==vin)return reply({error:'The discovered vehicle no longer matches this recording. Contact Letm3go support.'},409);
   const registered=await admin.from('fleet_bindings').select('owner_id,vehicle_id').eq('vin',vin).maybeSingle();
   if(registered.error)throw registered.error;
   if(registered.data&&(registered.data.owner_id!==owner||registered.data.vehicle_id!==vehicleID))
    return reply({error:'This vehicle already has a recording owner. Use the shared household feed.'},409);

   if(body.action==='pairingLink')return reply({url:pairingURL(vin)});
   if(!disabling&&(teslaLocationAccess(credentials)===false||selected?.hidePrivate===true))
    return reply({error:'Enable location access under Manage Tesla. Shared vehicles with private location hidden cannot stream routes.'},403);

   if(!disabling){
    const fleet=async(path:string,options:RequestInit={})=>{
     const response=await fetch(audience+path,{...options,headers:{Authorization:`Bearer ${credentials.access_token}`,'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(20000)});
     if(response.status===403||response.status===402){
      const stopped=await update({enabled:false,enabled_since:null,error:state?.error===REMOVAL_PENDING?REMOVAL_PENDING:state?.error===CONFIGURATION_PENDING?CONFIGURATION_PENDING:response.status===403?'Tesla location permission revoked':'Tesla billing limit reached'});
      if(stopped.error)throw stopped.error;
     }
     if(!response.ok)throw new Error(response.status===429?'Tesla rate limit reached. Retry later.':response.status===402?'Tesla billing limit reached. Check the developer portal.':response.status===403?'Tesla denied permission. Check location access in My Collection.':'Tesla could not check this vehicle. Retry while the vehicle is awake.');
     return response.json();
    };
    const fleetStatus=(await fleet('/api/1/vehicles/fleet_status',{method:'POST',body:JSON.stringify({vins:[vin]})})).response;
    const info={...fleetStatus?.vehicle_info?.[vin],key_paired:fleetStatus?.key_paired_vins?.includes(vin)===true};
    const support=compatibility(info);
    const keyState={key_paired:info.key_paired,key_required:support.keyRequired??null};
    const save=(values:Record<string,unknown>)=>state?update(values):admin.from('fleet_bindings').insert({vin,vehicle_id:vehicleID,owner_id:owner,...values});
    if(body.action==='check'){
     const needsVerification=state?.enabled||state?.config_synced||state?.error===CONFIGURATION_PENDING;
     const report=needsVerification?(await fleet(`/api/1/vehicles/${vin}/fleet_telemetry_config`)).response:null;
     const checked=checkedFleetConfiguration(state,support,report,host);
     const saved=await save({...keyState,...checked});if(saved.error)throw saved.error;
     return reply({compatibility:support,configSynced:checked.config_synced,message:checked.enabled?'Vehicle configuration verified.':undefined});
    }
    if(!support.ready)return reply({error:support.reason},409);
    // Reserve the binding first. A timeout may mean Tesla received the request, so retain the pending state.
    const submitted=await save({...keyState,enabled:false,enabled_since:null,last_received:null,stream_connected:null,connectivity_at:null,location_verified:false,config_synced:false,error:CONFIGURATION_PENDING});
    if(submitted.error)throw submitted.error;
   }
   const removalVerified=async()=>{
    const result=await fetch(`${audience}/api/1/vehicles/${vin}/fleet_telemetry_config`,{
     headers:{Authorization:`Bearer ${credentials.access_token}`},redirect:'error',signal:AbortSignal.timeout(20000)
    });
    return result.ok&&fleetConfigurationRemoved((await result.json()).response);
   };
   const finishRemoval=async()=>{
    const cleared=await update({error:null,config_synced:false,stream_connected:null});if(cleared.error)throw cleared.error;
    return reply({disabled:true});
   };
   if(disabling&&state?.error===REMOVAL_PENDING&&await removalVerified())return await finishRemoval();
   const actionBody=JSON.stringify({action:disabling?'delete':'configure',vin,accessToken:credentials.access_token,config:{hostname:host,port:443,ca,fields:FLEET_FIELDS}}),time=String(Date.now());
   const signingKey=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
   const signature=[...new Uint8Array(await crypto.subtle.sign('HMAC',signingKey,new TextEncoder().encode(`${time}.${actionBody}`)))].map(n=>n.toString(16).padStart(2,'0')).join('');
   const response=await fetch(control!,{method:'POST',headers:{'Content-Type':'application/json','x-lmg-time':time,'x-lmg-signature':signature},body:actionBody,redirect:'error',signal:AbortSignal.timeout(30000)});
   if(disabling){
    if(await removalVerified())return await finishRemoval();
    return reply({error:'Recording is stopped in Letm3go. Tesla has not yet confirmed removal of vehicle streaming. Retry when the vehicle is online.'},503);
   }
   if(!response.ok)return reply({error:'Configuration could not be confirmed. Check vehicle setup before starting a drive.'},503);
   return reply({configured:true,enabled:false,message:'Configuration submitted. Check vehicle setup after the vehicle connects, before your first drive.'});
  });
 }catch(error){return reply({error:error instanceof Error&&/^(Tesla |Setup |Reconnect Tesla|Connect your own Tesla)/.test(error.message)?error.message:'Vehicle recording could not be updated. Refresh status to see the next step.'},503);}
});
