// Trusted receiver output only. Never accept a client-supplied owner or household.
export const FLEET_FIELDS={Location:{interval_seconds:10,minimum_delta:25},Gear:{interval_seconds:1},VehicleSpeed:{interval_seconds:30,minimum_delta:5},Odometer:{interval_seconds:60,minimum_delta:0.1},DetailedChargeState:{interval_seconds:10},BatteryLevel:{interval_seconds:300,minimum_delta:1},DCChargingEnergyIn:{interval_seconds:300,minimum_delta:0.5}};
export function pairingURL(vin){if(!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin))throw new Error('Invalid vehicle identity.');return `https://tesla.com/_ak/letm3go.au?vin=${vin}`;}
export function compatibility(status){
 if(!status||!status.firmware_version)return {ready:false,reason:'Vehicle compatibility not verified'};
 if(!status.fleet_telemetry_version)return {ready:false,reason:'Telemetry is not supported or firmware needs updating'};
 const parts=status.firmware_version.split('.').map(Number);
 if(status.vehicle_command_protocol_required===false){if(parts[0]<2025||(parts[0]===2025&&parts[1]<20))return {ready:false,keyRequired:false,reason:'Legacy S/X requires firmware 2025.20 or newer'};return {ready:status.safety_screen_streaming_toggle_enabled===true,keyRequired:false,reason:status.safety_screen_streaming_toggle_enabled?'Vehicle streaming enabled':'Enable Allow Third-Party App Data Streaming in the vehicle Safety screen'};}
 if(parts[0]<2024||(parts[0]===2024&&parts[1]<26))return {ready:false,reason:'Firmware 2024.26 or newer required'};
 if(status.total_number_of_keys>=20&&!status.key_paired)return {ready:false,keyRequired:true,reason:'Vehicle has 20 keys. Remove an unused key before pairing.'};
 return {ready:status.key_paired===true,keyRequired:true,reason:status.key_paired?'Key paired':'Pair the Letm3go virtual key in the Tesla app'};
}
export function automaticRecordingStatus(setting,receiver,now=Date.now()){
 if(!setting?.enabled)return {active:false,label:'Setup required'};
 if(!receiver||now-Date.parse(receiver.last_seen)>120000||receiver.ready!==true)return {active:false,label:'Connection problem · receiver unavailable'};
 if(!setting.config_synced)return {active:false,label:'Setup pending · waiting for vehicle'};
 if(setting.error)return {active:false,label:'Connection problem'};
 if(setting.stream_connected===false)return {active:false,label:'Ready for future drives · vehicle not connected'};
 if(setting.last_received&&setting.enabled_since&&Date.parse(setting.last_received)<Date.parse(setting.enabled_since))return {active:false,label:'Configured · waiting for first telemetry'};
 if(!setting.last_received)return {active:false,label:'Configured · waiting for first telemetry'};
 if(now-Date.parse(setting.last_received)>24*3600000)return {active:false,label:'No recent telemetry · vehicle may be asleep'};
 return {active:true,label:'Automatic recording ready · last telemetry verified'};
}
const number=value=>{const n=Number(value);return value!==null&&value!==''&&Number.isFinite(n)?n:undefined;};
const allowed=new Set(Object.keys(FLEET_FIELDS));
export function normaliseFleetPayload(payload,authenticatedVin,now=Date.now()){
 if(!/^[A-HJ-NPR-Z0-9]{17}$/.test(authenticatedVin)||payload.vin!==authenticatedVin)throw new Error('Vehicle identity mismatch');
 const timestamp=Date.parse(payload.createdAt||payload.created_at);
 if(!Number.isFinite(timestamp)||timestamp>now+300000||timestamp<now-7*86400000)throw new Error('Event timestamp outside retention window');
 if(!Array.isArray(payload.data)||payload.data.length>100)throw new Error('Invalid telemetry frame');
 const fields={};
 for(const datum of payload.data){if(!allowed.has(datum.key))continue;const value=datum.value||{};if(value.invalid===true)continue;
  if(datum.key==='Location'){const p=value.locationValue||value.location_value;if(p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180)fields.location={latitude:p.latitude,longitude:p.longitude};}
  else if(datum.key==='Gear'){const gear=value.shiftStateValue||value.shift_state_value||value.stringValue||value.string_value;const map={ShiftStateD:'D',ShiftStateR:'R',ShiftStateP:'P',ShiftStateN:'N',D:'D',R:'R',P:'P',N:'N'};if(map[gear])fields.gear=map[gear];}
  else if(datum.key==='DetailedChargeState'){const charge=value.detailedChargeStateValue||value.detailed_charge_state_value||value.stringValue||value.string_value;if(['DetailedChargeStateCharging','Charging'].includes(charge))fields.charging=true;else if(['DetailedChargeStateDisconnected','DetailedChargeStateNoPower','DetailedChargeStateComplete','DetailedChargeStateStopped'].includes(charge))fields.charging=false;}
  else {const n=number(value.doubleValue??value.double_value??value.floatValue??value.float_value??value.stringValue??value.string_value??value.intValue??value.int_value);
   if(n===undefined)continue;if(datum.key==='VehicleSpeed'&&n>=0&&n<=180)fields.speed=n*0.44704;
   if(datum.key==='Odometer'&&n>=0&&n<=2000000)fields.odometer=n*1609.344;
   if(datum.key==='BatteryLevel'&&n>=0&&n<=100)fields.battery=n;
   if(datum.key==='DCChargingEnergyIn'&&n>=0&&n<=1000)fields.energy=n;
  }
 }
 return {vin:authenticatedVin,timestamp:timestamp/1000,fields};
}
export function normaliseConnectivity(payload,authenticatedVin,now=Date.now()){
 if(payload.vin!==authenticatedVin||!/^[A-HJ-NPR-Z0-9]{17}$/.test(authenticatedVin)||!['CONNECTED','DISCONNECTED'].includes(payload.status))throw new Error('Invalid connectivity frame');
 const time=Date.parse(payload.createdAt||payload.created_at);if(!Number.isFinite(time)||time>now+300000||time<now-7*86400000)throw new Error('Invalid connectivity time');
 return {vin:authenticatedVin,timestamp:time/1000,fields:{connected:payload.status==='CONNECTED'}};
}
export async function eventFingerprint(event,cryptoImpl=crypto){const fields=Object.fromEntries(Object.entries(event.fields).sort(([a],[b])=>a.localeCompare(b)));const bytes=await cryptoImpl.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({vin:event.vin,timestamp:event.timestamp,fields})));return [...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');}
export async function stableUUID(value,cryptoImpl=crypto){const bytes=new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',new TextEncoder().encode(value)));bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;const s=[...bytes.slice(0,16)].map(n=>n.toString(16).padStart(2,'0')).join('');return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;}
const distance=(a,b)=>{const r=Math.PI/180,x=Math.sin((a.latitude-b.latitude)*r/2)**2+Math.cos(a.latitude*r)*Math.cos(b.latitude*r)*Math.sin((a.longitude-b.longitude)*r/2)**2;return 6371000*2*Math.atan2(Math.sqrt(x),Math.sqrt(Math.max(0,1-x)));};
// Replay immutable, bounded events sorted by event time. Replays retain IDs by overlap.
export async function reconstructFleet(events,{vehicleID,ownerID,enabledSince,existing=[],cryptoImpl=crypto,now=Date.now()/1000}){
 const frames=[...new Map(events.filter(e=>e.timestamp>=enabledSince).map(e=>[JSON.stringify([e.timestamp,e.fields]),e])).values()].sort((a,b)=>a.timestamp-b.timestamp||JSON.stringify(a.fields).localeCompare(JSON.stringify(b.fields)));
 const drives=[],charges=[];let drive=null,charge=null,last={},gearAt=0,parkedAt=null,lastLocation=null;
 function finish(end,incomplete=false){if(drive){drive.endedAt=Math.max(drive.startedAt,end);drive.incomplete ||= incomplete;drives.push(drive);drive=null;}}
 for(const e of frames){const f=e.fields,t=e.timestamp;
  if(Object.keys(f).every(k=>k==='connected'))continue;
  if(f.gear){last.gear=f.gear;gearAt=t;if(f.gear==='P'){parkedAt=t;}else if(['D','R'].includes(f.gear))parkedAt=null;}
  if(f.location)lastLocation={...f.location,timestamp:t};
  if(['D','R'].includes(f.gear)){last.charging=false;if(charge){charge.endedAt=t;charge.incomplete=true;charges.push(charge);charge=null;}}
  if(f.charging===true)finish(t,true);
  const moving=f.charging!==true&&last.charging!==true&&((['D','R'].includes(f.gear))||(f.location&&['D','R'].includes(last.gear)&&t-gearAt<=1800)||(f.speed>1.5&&last.gear!=='P'));
  if(drive&&t-drive.lastAt>900)finish(drive.lastAt,true);
  if(moving&&!drive){drive={startedAt:t,endedAt:t,lastAt:t,points:[],distanceMeters:0,odometerStart:f.odometer??last.odometer,odometerEnd:f.odometer??last.odometer,incomplete:false};if(lastLocation&&t-lastLocation.timestamp<=30)drive.points.push({...lastLocation,accuracy:65,accuracySource:'unreported',speed:f.speed||0,segment:0});}
  if(drive){drive.lastAt=t;drive.endedAt=t;if(f.odometer!=null)drive.odometerEnd=f.odometer;
   if(f.location){const previous=drive.points.at(-1),gap=previous?t-previous.timestamp:0;const d=previous?distance(previous,f.location):0;const broken=gap>120||(gap>0&&d/gap>85);const sample={...f.location,timestamp:t,accuracy:65,accuracySource:'unreported',speed:f.speed||0,segment:(previous?.segment||0)+(broken?1:0)};if(!previous||t>previous.timestamp){drive.points.push(sample);if(previous&&!broken)drive.distanceMeters+=d;}if(broken)drive.incomplete=true;}
  }
  if(f.gear==='P')finish(t);
  if(f.charging===true&&!charge){charge={startedAt:t,endedAt:t,latitude:lastLocation&&t-lastLocation.timestamp<=300?lastLocation.latitude:undefined,longitude:lastLocation&&t-lastLocation.timestamp<=300?lastLocation.longitude:undefined,batteryBefore:f.battery??(t-(last.batteryAt||0)<=600?last.battery:undefined),energyStart:f.energy};}
  if(charge){charge.endedAt=t;if(f.battery!=null)charge.batteryAfter=f.battery;if(f.energy!=null)charge.energyEnd=f.energy;if(f.charging===false){charges.push(charge);charge=null;}}
  last={...last,...f,...(f.battery!=null?{batteryAt:t}:{})};
 }
 if(drive)finish(drive.lastAt,now-drive.lastAt>900||parkedAt==null);
 if(charge){charge.incomplete=true;charges.push(charge);}
 const used=new Set();
 for(const d of drives){
  const matches=existing.filter(s=>!used.has(s.id)&&Math.max(0,Math.min(s.endedAt,d.endedAt)-Math.max(s.startedAt,d.startedAt))/Math.max(1,Math.min(s.endedAt-s.startedAt,d.endedAt-d.startedAt))>0.65).sort((a,b)=>a.startedAt-b.startedAt);
  d.id=matches[0]?.id||await stableUUID(`${ownerID}:${vehicleID}:${d.startedAt}`,cryptoImpl);used.add(d.id);
  const odometer=d.odometerEnd-d.odometerStart;const seconds=d.endedAt-d.startedAt;
  if(Number.isFinite(odometer)&&odometer>=0&&odometer<=seconds*85)d.distanceMeters=odometer;
  d.incomplete ||= d.points.length<2;d.durationSeconds=seconds;d.vehicleID=vehicleID;d.ownerID=ownerID;d.source='tesla';d.recordingMode='tesla';d.activity='Driving';d.title='Driving';d.state='finished';d.details={tags:['Tesla'],classification:{predicted:'Driving',confidence:'high',evidence:['Vehicle telemetry; driver identity is not inferred']}};
 }
 return {drives:drives.filter(d=>d.durationSeconds>=10),charges:charges.map(c=>({...c,ownerID,vehicleID,verified:true,type:'charging',energyAdded:c.energyEnd>=c.energyStart?c.energyEnd-c.energyStart:null}))};
}
export async function verifyIngestion(body,timestamp,signature,key,{cryptoImpl=crypto,now=Date.now()}={}){
 if(!key||key.length<32||!/^\d{13}$/.test(timestamp||'')||Math.abs(now-Number(timestamp))>60000||!/^[a-f0-9]{64}$/.test(signature||''))return false;
 const secret=await cryptoImpl.subtle.importKey('raw',new TextEncoder().encode(key),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 return cryptoImpl.subtle.verify('HMAC',secret,Uint8Array.from(signature.match(/../g),h=>parseInt(h,16)),new TextEncoder().encode(`${timestamp}.${body}`));
}
