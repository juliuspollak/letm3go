import assert from 'node:assert/strict';
import {localRecorderJourneys} from '../src/lib/recorder.js';
import {reconcileRecorderSnapshot,snapshotKey} from '../src/lib/useRecorder.js';

// Synthetic only. Measures the history portion of a poll; live data/preferences
// and native runtime frame timing are outside this benchmark.
const trips=Array.from({length:100},(_,i)=>({id:`synthetic-${i}`,source:i%2?'device':'watch',recordingMode:'manual',title:`Synthetic activity ${i}`,activity:'Walking',updatedAt:1,
 startedAt:10000+i*10000,endedAt:13000+i*10000,durationSeconds:3000,distanceMeters:1000,details:{},
 points:Array.from({length:500},(_,n)=>({latitude:-30+i*.01,longitude:150+n*.00001,timestamp:10000+i*10000+n*5,accuracy:5,altitude:0,speed:1,segment:0}))}));
const full={ownerID:'synthetic-owner',historyToken:'synthetic-history',trips,places:[]};
const delta={ownerID:full.ownerID,historyToken:full.historyToken,historyUnchanged:true,trips:[]};
const cache=new WeakMap(),first=localRecorderJourneys(full,full.ownerID,cache);
const historyFingerprints=new WeakMap();snapshotKey(full,historyFingerprints);
const started=performance.now();let state=full;
for(let n=0;n<100;n++){
 state=reconcileRecorderSnapshot(state,{...delta,currentSpeed:n});
 assert.equal(state.trips,full.trips);
 snapshotKey(state,historyFingerprints);
 const next=localRecorderJourneys(state,full.ownerID,cache);
 assert.ok(next.every((trip,i)=>trip===first[i]));
}
const fullBytes=Buffer.byteLength(JSON.stringify(full)),unchangedBytes=Buffer.byteLength(JSON.stringify(delta));
assert.ok(unchangedBytes<fullBytes*.01);
console.log(JSON.stringify({synthetic:true,activities:trips.length,gpsPoints:50000,polls:100,historyPayloadBytes:fullBytes,unchangedHistoryPayloadBytes:unchangedBytes,historyPayloadReductionPercent:Number((100*(1-unchangedBytes/fullBytes)).toFixed(3)),unchangedRouteProjectionsReused:true,warmPollChecksMilliseconds:Number((performance.now()-started).toFixed(1)),scope:'history payload only; not real-device frame timing'},null,2));
