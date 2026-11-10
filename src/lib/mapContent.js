// Pure additions to a map payload, shared by the React and native screens.
// Named segment layers go above the route and its pins (namedSegments.segmentLayers).
export function withSegments(payload,layers){
 if(!layers)return payload;
 return {...payload,pins:[...payload.pins,...layers.pins],styled:layers.styled,...(layers.muted?{muted:true}:{})};
}
// The Map's Segments layer: each community segment as a styled line (the native
// map draws at most 60) and a tappable pin at its start that opens its details.
export const SEGMENT_LAYER_COLOR='#e8590c';
export function withCommunitySegments(payload,segments){
 if(!segments?.length)return payload;
 const shown=segments.filter(s=>Array.isArray(s.geometry)&&s.geometry.length>1).slice(0,60);
 return {...payload,
  // `community` marks content that changes as the map moves: AppleMap sends it as
  // an update, never as a re-embed (the native map redraws lines and pins in place).
  styled:[...(payload.styled||[]),...shown.map(s=>({points:s.geometry,color:SEGMENT_LAYER_COLOR,width:4,community:true}))].slice(0,60),
  pins:[...(payload.pins||[]),...shown.map(s=>({id:'community-segment:'+s.id,point:s.geometry[0],title:s.name,kind:'segment',color:SEGMENT_LAYER_COLOR,segmentID:s.id}))]};
}
// The part of a recording the trim handles keep, split where recording segments
// change, so a gap is never drawn. Start and Finish move with the handles.
// The native map draws up to 5000 points per line and cuts the rest, so a long
// recording is thinned first. Both ends stay, so the line still reaches them.
export const MAP_LINE_POINTS=4000;
export function thinLine(line,limit=MAP_LINE_POINTS){
 if(line.length<=limit)return line;
 const step=(line.length-1)/(limit-1);
 return Array.from({length:limit},(_,i)=>line[Math.round(i*step)]);
}
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
 return {...payload,routes:routes.map(line=>thinLine(line)),pins};
}
