import {createClient} from 'npm:@supabase/supabase-js@2';
import {verifyIngestion,reconstructFleet,eventFingerprint,stableUUID} from '../_shared/fleetTelemetry.js';
const reply=(status:number)=>new Response(JSON.stringify({ok:status===200}),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
Deno.serve(async request=>{
 if(request.method!=='POST')return reply(405);
 const reader=request.body?.getReader();if(!reader)return reply(400);const chunks:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();return reply(413);}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}const text=new TextDecoder().decode(bytes);
 if(!await verifyIngestion(text,request.headers.get('x-lmg-time'),request.headers.get('x-lmg-signature'),Deno.env.get('FLEET_INGEST_SECRET')))return reply(401);
 try{
  const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  const payload=JSON.parse(text);
  if(payload.heartbeat===true){const result=await admin.from('fleet_receiver_health').upsert({id:'primary',ready:payload.ready===true,last_seen:new Date().toISOString(),version:String(payload.version||'unknown').slice(0,100)});return reply(result.error?503:200);}
  const event=payload.event;if(!event||!/^[A-HJ-NPR-Z0-9]{17}$/.test(event.vin)||!Number.isFinite(event.timestamp)||!event.fields||typeof event.fields!=='object')return reply(400);
  const fingerprint=await eventFingerprint(event);
  for(let attempt=0;attempt<3;attempt++){
   const {data,error}=await admin.rpc('ingest_fleet_event',{p_vin:event.vin,p_fingerprint:fingerprint,p_time:new Date(event.timestamp*1000).toISOString(),p_fields:event.fields});
   if(error){await admin.from('fleet_bindings').update({error:'Telemetry processing paused; operator check required'}).eq('vin',event.vin);return reply(503);}if(data.ignored)return reply(200);
   const projection=await reconstructFleet(data.events,{vehicleID:data.vehicle,ownerID:data.owner,enabledSince:data.enabledSince,existing:data.existing});
   const charges=await Promise.all(projection.charges.map(async c=>({...c,id:await stableUUID(`${data.owner}:${data.vehicle}:charge:${c.startedAt}`)})));
   const committed=await admin.rpc('commit_fleet_projection',{p_vin:event.vin,p_revision:data.revision,p_drives:projection.drives,p_charges:charges});
   if(committed.error)return reply(503);if(committed.data===true)return reply(200);
  }
  return reply(503);
 }catch{return reply(400);}
});
