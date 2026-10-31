// Apple Watch heart rate for one activity. Everything here reads the private
// journal record; none of it leaves the phone. Nothing is interpolated: a stretch
// with no readings stays empty on the graph and counts for no zone.
export const GAP_SECONDS=30;
export const ZONES=[
 {id:1,name:'Zone 1',from:.5,to:.6},{id:2,name:'Zone 2',from:.6,to:.7},{id:3,name:'Zone 3',from:.7,to:.8},
 {id:4,name:'Zone 4',from:.8,to:.9},{id:5,name:'Zone 5',from:.9,to:Infinity}
];
const finite=Number.isFinite;

export function heartRateOf(trip){
 const record=trip?.details?.heartRate;
 if(!Array.isArray(record?.samples)||!record.samples.length||!record.summary)return null;
 const samples=record.samples.filter(s=>finite(s?.timestamp)&&finite(s?.bpm));
 if(!samples.length)return null;
 return {samples,pausePeriods:(record.pausePeriods||[]).filter(p=>finite(p?.start)&&finite(p?.end)),summary:record.summary};
}
const crossesPause=(a,b,pauses)=>pauses.some(p=>p.start<b.timestamp&&p.end>a.timestamp);
// Runs of readings the line may join. A pause or a sensor gap ends a run.
export function heartRateRuns(samples,pausePeriods=[]){
 const runs=[];
 for(const sample of samples){
  const run=runs.at(-1),last=run?.at(-1);
  if(last&&sample.timestamp-last.timestamp<=GAP_SECONDS&&!crossesPause(last,sample,pausePeriods))run.push(sample);
  else runs.push([sample]);
 }
 return runs;
}
// Seconds a reading stands for: until the next one, no further than a gap allows.
export function timeInZones(samples,pausePeriods,maximum){
 const seconds=ZONES.map(()=>0);
 let below=0;
 if(!finite(maximum)||maximum<=0)return null;
 samples.forEach((sample,index)=>{
  const next=samples[index+1];
  if(!next||crossesPause(sample,next,pausePeriods))return;
  const span=next.timestamp-sample.timestamp;
  if(span>GAP_SECONDS)return;
  const share=sample.bpm/maximum;
  const zone=ZONES.findIndex(z=>share>=z.from&&share<z.to);
  if(zone<0)below+=span;else seconds[zone]+=span;
 });
 const total=seconds.reduce((a,b)=>a+b,below);
 return {zones:ZONES.map((zone,index)=>({...zone,seconds:seconds[index],share:total?seconds[index]/total:0,fromBpm:Math.round(zone.from*maximum),toBpm:zone.to===Infinity?null:Math.round(zone.to*maximum)})),belowSeconds:below,totalSeconds:total};
}
// Distance and speed at a moment of the graph, from the same recording's fixes.
export function routeAt(points,timestamp){
 if(!points?.length)return null;
 let travelled=0,previous=null,found=null;
 for(const point of points){
  if(point.timestamp>timestamp)break;
  if(previous&&previous.segment===point.segment)travelled+=metres(previous,point);
  previous=point;found=point;
 }
 if(!found||timestamp-found.timestamp>GAP_SECONDS)return null;
 return {distanceMeters:travelled,speed:finite(found.speed)&&found.speed>=0?found.speed:null};
}
function metres(a,b){
 const r=Math.PI/180,dlat=(b.latitude-a.latitude)*r,dlon=(b.longitude-a.longitude)*r;
 const x=Math.sin(dlat/2)**2+Math.cos(a.latitude*r)*Math.cos(b.latitude*r)*Math.sin(dlon/2)**2;
 return 6371000*2*Math.atan2(Math.sqrt(x),Math.sqrt(Math.max(0,1-x)));
}
// A person's own figure. Never assumed or derived from age: without one, no zones.
const key=owner=>`letm3go.maximumHeartRate.${owner||'device'}`;
export function savedMaximum(owner,storage=globalThis.localStorage){
 const value=Number(storage?.getItem(key(owner)));
 return finite(value)&&value>=100&&value<=240?value:null;
}
export function saveMaximum(owner,value,storage=globalThis.localStorage){
 const number=Math.round(Number(value));
 if(!finite(number)||number<100||number>240){storage?.removeItem(key(owner));return null;}
 storage?.setItem(key(owner),String(number));
 return number;
}
