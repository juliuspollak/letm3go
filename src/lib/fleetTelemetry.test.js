import {it,expect} from 'vitest';
import {webcrypto,createHmac} from 'node:crypto';
import {normaliseFleetPayload,reconstructFleet,compatibility,pairingURL,automaticRecordingStatus,verifyIngestion,eventFingerprint} from '../../supabase/functions/_shared/fleetTelemetry.js';
const vin='5YJ3E1EA0KF000001',owner='owner',vehicle='car',base=Date.now()/1000-10000;
const event=(delta,fields)=>({vin,timestamp:base+delta,fields});
const options={ownerID:owner,vehicleID:vehicle,enabledSince:base,cryptoImpl:webcrypto,now:base+1000};
const p={latitude:-33.86,longitude:151.2};
const drive=[event(0,{gear:'D',location:p,odometer:10000}),event(30,{location:{latitude:-33.85,longitude:151.2},speed:15,odometer:11000}),event(60,{gear:'P',location:{latitude:-33.84,longitude:151.2},odometer:12000})];
it('normalises official proto JSON and converts miles/mph without retaining unrelated vehicle data',()=>{
 const frame={vin,createdAt:new Date(base*1000).toISOString(),data:[{key:'Gear',value:{shiftStateValue:'ShiftStateD'}},{key:'VehicleSpeed',value:{doubleValue:60}},{key:'Odometer',value:{doubleValue:100}},{key:'Location',value:{locationValue:p}},{key:'VehicleName',value:{stringValue:'private'}}]};
 const result=normaliseFleetPayload(frame,vin);expect(result.fields.speed).toBeCloseTo(26.8224);expect(result.fields.odometer).toBeCloseTo(160934.4);expect(result.fields.gear).toBe('D');expect(result.fields.VehicleName).toBeUndefined();expect(()=>normaliseFleetPayload({...frame,vin:'5YJ3E1EA0KF000002'},vin)).toThrow('identity');
});
it('rejects invalid timestamps, invalid signals and locations and never trusts owner data',()=>{
 expect(()=>normaliseFleetPayload({vin,createdAt:'invalid',data:[]},vin)).toThrow();
 const f={vin,owner:'attacker',createdAt:new Date(base*1000).toISOString(),data:[{key:'Location',value:{locationValue:{latitude:200,longitude:0}}},{key:'BatteryLevel',value:{invalid:true}},{key:'DetailedChargeState',value:{detailedChargeStateValue:'DetailedChargeStateUnknown'}}]};const result=normaliseFleetPayload(f,vin);expect(result.fields).toEqual({});expect(result.owner).toBeUndefined();
});
it('starts on drive, includes the parked endpoint and uses reliable odometer distance',async()=>{
 const result=await reconstructFleet(drive,options);expect(result.drives).toHaveLength(1);const d=result.drives[0];expect(d.startedAt).toBe(base);expect(d.endedAt).toBe(base+60);expect(d.points).toHaveLength(3);expect(d.distanceMeters).toBe(2000);expect(d.incomplete).toBe(false);
});
it('is idempotent under duplicate, delayed and out-of-order data and retains an existing drive ID',async()=>{
 const a=await reconstructFleet(drive,options),b=await reconstructFleet([...drive].reverse().concat(drive),options);expect(a).toEqual(b);const reused=await reconstructFleet(drive,{...options,existing:[{id:'existing',startedAt:base+1,endedAt:base+59}]});expect(reused.drives[0].id).toBe('existing');
});
it('retains missing GPS gaps honestly and does not fabricate coordinates',async()=>{
 const result=await reconstructFleet([event(0,{gear:'D'}),event(10,{location:p}),event(300,{location:{latitude:-33.7,longitude:151.2}}),event(350,{gear:'P'})],options);expect(result.drives[0].points).toHaveLength(2);expect(result.drives[0].points[1].segment).toBe(1);expect(result.drives[0].incomplete).toBe(true);
});
it('confirms charging only from charging state, recording battery and reliable energy changes',async()=>{
 const stream=[...drive,event(70,{charging:true,battery:30,energy:0}),event(800,{battery:60,energy:22}),event(900,{charging:false,battery:65,energy:25})];const result=await reconstructFleet(stream,options);expect(result.charges).toHaveLength(1);expect(result.charges[0]).toMatchObject({verified:true,vehicleID:vehicle,ownerID:owner,batteryBefore:30,batteryAfter:65,energyAdded:25});expect((await reconstructFleet(drive,options)).charges).toHaveLength(0);
});
it('does not import old drives before enablement and does not guess a completed drive after an outage',async()=>{
 expect((await reconstructFleet(drive,{...options,enabledSince:base+120})).drives).toHaveLength(0);const result=await reconstructFleet(drive.slice(0,2),options);expect(result.drives[0].incomplete).toBe(true);
});
it('validates pairing URL and gates unsupported or legacy vehicle prerequisites',()=>{
 expect(pairingURL(vin)).toBe(`https://tesla.com/_ak/letm3go.au?vin=${vin}`);expect(()=>pairingURL('bad')).toThrow();expect(compatibility({firmware_version:'2024.25',fleet_telemetry_version:'1'}).ready).toBe(false);expect(compatibility({firmware_version:'2026.1',fleet_telemetry_version:'1',vehicle_command_protocol_required:true,key_paired:false}).ready).toBe(false);expect(compatibility({firmware_version:'2026.1',fleet_telemetry_version:'1',vehicle_command_protocol_required:false,safety_screen_streaming_toggle_enabled:true}).ready).toBe(true);
});
it('never calls a connection active without enablement, verified config, healthy receiver and actual data',()=>{
 const setting={enabled:true,config_synced:true,last_received:new Date().toISOString()};expect(automaticRecordingStatus(null,null).active).toBe(false);expect(automaticRecordingStatus(setting,null).active).toBe(false);expect(automaticRecordingStatus({...setting,last_received:null},{ready:true,last_seen:new Date().toISOString()}).active).toBe(false);expect(automaticRecordingStatus(setting,{ready:true,last_seen:new Date().toISOString()}).active).toBe(true);
});
it('authenticates the exact body and timestamp and rejects spoofing/replay',async()=>{
 const secret='s'.repeat(32),body=JSON.stringify({event:drive[0]}),time=String(Date.now()),signature=createHmac('sha256',secret).update(`${time}.${body}`).digest('hex');expect(await verifyIngestion(body,time,signature,secret,{cryptoImpl:webcrypto})).toBe(true);expect(await verifyIngestion(body+' ',time,signature,secret,{cryptoImpl:webcrypto})).toBe(false);expect(await verifyIngestion(body,time,signature,secret,{cryptoImpl:webcrypto,now:Number(time)+70000})).toBe(false);expect(await eventFingerprint(drive[0],webcrypto)).toBe(await eventFingerprint({...drive[0],fields:{odometer:10000,location:p,gear:'D'}},webcrypto));
});
it('uses a minimal fixed signal plan with no wake/poll signals and a bounded monthly engineering estimate',async()=>{
 const {FLEET_FIELDS}=await import('../../supabase/functions/_shared/fleetTelemetry.js');const {estimateFleetCost}=await import('../../services/fleet-telemetry/costs.mjs');expect(Object.keys(FLEET_FIELDS)).toHaveLength(7);expect(FLEET_FIELDS.Location.interval_seconds).toBe(10);expect(FLEET_FIELDS.Odometer.minimum_delta).toBe(0.1);expect(estimateFleetCost().wakesUSD).toBe(0);expect(estimateFleetCost().totalUSD).toBeLessThan(1);
});
it('keeps separate driving segments and a real charging stop for the journey grouper',async()=>{
 const events=[...drive,event(70,{charging:true,battery:30,energy:0}),event(2100,{charging:false,battery:70,energy:25}),event(2200,{gear:'D',location:{latitude:-33.84,longitude:151.2}}),event(2300,{location:{latitude:-33.83,longitude:151.2}}),event(2400,{gear:'P'})];const result=await reconstructFleet(events,{...options,now:base+2500});expect(result.drives).toHaveLength(2);expect(result.charges).toHaveLength(1);expect(result.drives[1].id).not.toBe(result.drives[0].id);
});
it('validates actual connectivity messages without turning a connection into a drive',async()=>{
 const {normaliseConnectivity}=await import('../../supabase/functions/_shared/fleetTelemetry.js');const connected=normaliseConnectivity({vin,status:'CONNECTED',createdAt:new Date(base*1000).toISOString()},vin);expect((await reconstructFleet([connected],options)).drives).toHaveLength(0);expect(()=>normaliseConnectivity({vin,status:'UNKNOWN',createdAt:new Date().toISOString()},vin)).toThrow();
});
it('requires new telemetry after re-enabling rather than using yesterday’s successful recording',()=>{
 const now=Date.now();const result=automaticRecordingStatus({enabled:true,config_synced:true,enabled_since:new Date(now).toISOString(),last_received:new Date(now-3600000).toISOString()},{ready:true,last_seen:new Date(now).toISOString()},now);expect(result.active).toBe(false);expect(result.label).toContain('first telemetry');
});
