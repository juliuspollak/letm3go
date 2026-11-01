const point=p=>p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180;
export function metres(a,b){if(!point(a)||!point(b))return Infinity;const r=Math.PI/180,dlat=(b.latitude-a.latitude)*r,dlon=(b.longitude-a.longitude)*r,x=Math.sin(dlat/2)**2+Math.cos(a.latitude*r)*Math.cos(b.latitude*r)*Math.sin(dlon/2)**2;return 6371000*2*Math.atan2(Math.sqrt(x),Math.sqrt(Math.max(0,1-x)));}
// Distance-spaced geometry prevents a long stop or dense GPS cluster dominating
// similarity. No segments across breaks, poor fixes or unobserved time are added.
function routeSamples(trip){
 const result=[],points=trip.points||[];
 let next=0;
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],distance=metres(a,b),dt=b.timestamp-a.timestamp;
  if(!point(a)||!point(b)||!Number.isFinite(a.accuracy)||!Number.isFinite(b.accuracy)||a.accuracy>40||b.accuracy>40||a.segment!==b.segment||dt<=0||dt>120||distance>500){next=0;continue;}
  if(distance<.01)continue;
  for(;next<distance&&result.length<2000;next+=25){const f=next/distance;result.push({latitude:a.latitude+(b.latitude-a.latitude)*f,longitude:a.longitude+(b.longitude-a.longitude)*f});}
  next=Math.max(0,next-distance);
 }
 return result;
}
export function compareRoutes(a,b){
 const left=routeSamples(a),right=routeSamples(b);
 const coverage=(x,y)=>x.length?x.filter(p=>y.some(q=>metres(p,q)<=40)).length/x.length:0;
 const forward=coverage(left,right),reverse=coverage(right,left);
 const enough=left.length>=12&&right.length>=12,similar=enough&&Math.min(forward,reverse)>=.85;
 return {similar,partial:!similar&&enough&&Math.max(forward,reverse)>=.9&&Math.min(forward,reverse)>=.6,coverage:[forward,reverse],sampleCounts:[left.length,right.length]};
}
