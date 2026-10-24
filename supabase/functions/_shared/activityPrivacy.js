export function metersBetween(a,b){const r=Math.PI/180,dlat=(b.latitude-a.latitude)*r,dlon=(b.longitude-a.longitude)*r;const s=Math.sin(dlat/2)**2+Math.cos(a.latitude*r)*Math.cos(b.latitude*r)*Math.sin(dlon/2)**2;return 6371000*2*Math.atan2(Math.sqrt(s),Math.sqrt(Math.max(0,1-s)));}
export function segmentNearPlace(a,b,place,buffer=300){
 const r=Math.PI/180,scale=6371000*r,cos=Math.cos(place.latitude*r);
 const delta=lon=>((lon-place.longitude+540)%360)-180;
 const ax=delta(a.longitude)*cos*scale,ay=(a.latitude-place.latitude)*scale,bx=delta(b.longitude)*cos*scale,by=(b.latitude-place.latitude)*scale;
 // Very long links or polar geometry are unsafe to expose as an interpolated line.
 if(Math.abs(place.latitude)>80||metersBetween(a,b)>10000)return true;
 const dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy||1)));
 return Math.hypot(ax+t*dx,ay+t*dy)<=place.radius+buffer;
}
export function redactRoute(points,places,buffer=300){
 const sensitive=places.filter(p=>['home','work'].includes(p.kind)),result=[];let segment=0,previous=null;
 for(const p of points){
  const hidden=sensitive.some(place=>metersBetween(p,place)<=place.radius+buffer);
  if(hidden){previous=null;segment++;continue;}
  const cut=previous&&(previous.segment!==p.segment||sensitive.some(place=>segmentNearPlace(previous,p,place,buffer)));
  if(cut)segment++;
  // Only geography survives; no timestamps, accuracy, raw speed or private identifiers.
  result.push({latitude:p.latitude,longitude:p.longitude,segment});previous=p;
 }
 return result;
}
export function publicationPreview(trip,places,photoIDs=[]){
 const points=redactRoute(trip.points||[],places);
 const selected=(trip.photos||[]).filter(p=>photoIDs.includes(p.id));
 return {title:trip.title,activity:trip.activity,description:trip.description||'',points,photos:selected.filter(p=>p.locationSource!=='gps'&&p.locationSource!=='inferred'||!p.point||!places.some(place=>['home','work'].includes(place.kind)&&metersBetween({latitude:p.point[0],longitude:p.point[1]},place)<=place.radius+300)).map(p=>({id:p.id,caption:p.caption})),visibility:'public'};
}
export function sourceLabel(trip){const mode=trip.recordingMode;return mode==='automatic'?'Automatically detected · iPhone':mode==='historical'?'Added manually':mode==='tesla'?'Automatically recorded · Tesla':mode==='combined'?'Combined · Tesla + iPhone':'High-accuracy GPS · Started manually';}
