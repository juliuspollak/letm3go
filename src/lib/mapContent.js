// Pure additions to a map payload, shared by the React and native screens.
// Named segment layers go above the route and its pins (namedSegments.segmentLayers).
export function withSegments(payload,layers){
 if(!layers)return payload;
 return {...payload,pins:[...payload.pins,...layers.pins],styled:layers.styled,...(layers.muted?{muted:true}:{})};
}
// The part of a recording the trim handles keep, split where recording segments
// change, so a gap is never drawn. Start and Finish move with the handles.
export function withTrimRange(payload,trimRange){
 if(!(trimRange?.points?.length>1))return payload;
 const points=trimRange.points.slice(trimRange.start,trimRange.end+1).filter(p=>Number.isFinite(p.latitude)&&Number.isFinite(p.longitude));
 if(points.length<2)return payload;
 const routes=[];let segment=null;
 for(const point of points){
  if(point.segment!==segment){routes.push([]);segment=point.segment;}
  routes.at(-1).push([point.latitude,point.longitude]);
 }
 const pins=payload.pins.filter(pin=>!['start','finish'].includes(pin.kind));
 pins.push({point:routes[0][0],title:'Start',kind:'start'},{point:routes.at(-1).at(-1),title:'Finish',kind:'finish'});
 return {...payload,routes,pins};
}
