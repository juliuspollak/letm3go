// Display geometry only. Recording, sync and measured distance retain raw fixes.
export const MAX_DISPLAY_STEP_METRES=2000;
export const MAX_DISPLAY_DEVIATION_METRES=2;
const SCALE=111320;
export const validDisplayPoint=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180&&!(p[0]===0&&p[1]===0);
export function displayMetres(a,b){return Math.hypot((b[0]-a[0])*SCALE,(b[1]-a[1])*SCALE*Math.cos((a[0]+b[0])*Math.PI/360));}

// Split BEFORE simplification: deleting an invalid sample must not turn its two
// neighbours into a travelled stretch. No interpolation across unknown ground.
function runs(segments){
 const result=[];
 for(const segment of segments||[]){
  let run=[];
  for(const point of Array.isArray(segment)?segment:[]){
   if(!validDisplayPoint(point)){if(run.length)result.push(run);run=[];continue;}
   if(run.length&&displayMetres(run.at(-1),point)>MAX_DISPLAY_STEP_METRES){result.push(run);run=[];}
   run.push(point);
  }
  if(run.length)result.push(run);
 }
 return result;
}

// Douglas–Peucker keeps original vertices, including the largest turns. Unlike
// every-Nth-point sampling it cannot systematically miss a corner between ticks.
function simplify(points,budget){
 if(points.length<=budget)return points;
 // Bound worst-case RDP work on densely zigzagging tracks. The block boundary
 // remains an original vertex; no chord skips the observation between blocks.
 if(points.length>512){
  const result=[];
  for(let i=0;i<points.length-1;i+=511){
   const block=points.slice(i,i+512),part=simplify(block,Math.max(2,Math.floor(budget*block.length/points.length)));
   result.push(...(i?part.slice(1):part));
  }
  return result;
 }
 const cos=Math.cos(points[0][0]*Math.PI/180);
 const xy=points.map(p=>[(p[1]-points[0][1])*SCALE*cos,(p[0]-points[0][0])*SCALE]);
 const atTolerance=tolerance=>{
  const keep=new Uint8Array(points.length);keep[0]=1;keep[points.length-1]=1;
  const stack=[[0,points.length-1]],squared=tolerance*tolerance;
  while(stack.length){
   const [first,last]=stack.pop(),a=xy[first],b=xy[last],dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;
   let largest=squared,index=-1;
   for(let i=first+1;i<last;i++){
    const p=xy[i],t=length?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)):0;
    const distance=(p[0]-a[0]-t*dx)**2+(p[1]-a[1]-t*dy)**2;
    if(distance>largest){largest=distance;index=i;}
   }
   if(index>=0){keep[index]=1;stack.push([first,index],[index,last]);}
  }
  return points.filter((_,i)=>keep[i]);
 };
 let low=0,high=1,best=atTolerance(high);
 while(best.length>budget&&high<MAX_DISPLAY_DEVIATION_METRES){low=high;high=Math.min(MAX_DISPLAY_DEVIATION_METRES,high*2);best=atTolerance(high);}
 if(best.length>budget)return best; // Preserve real turns instead of forcing a quota.
 for(let i=0;i<12;i++){const middle=(low+high)/2,candidate=atTolerance(middle);if(candidate.length>budget)low=middle;else{high=middle;best=candidate;}}
 return best;
}
export function displaySegments(journey,limit=2000){
 const segments=runs(journey.routeSegments||[journey.route||[]]);
 const count=segments.reduce((n,s)=>n+s.length,0);
 if(count<=limit)return segments;
 // Limit is a target, never permission to cut a corner beyond two metres.
 // Split retained detail before native per-polyline caps, overlapping endpoints.
 return segments.flatMap(segment=>{
  const line=simplify(segment,Math.max(2,Math.floor(limit*segment.length/count)));
  if(line.length<=2000)return [line];
  const parts=[];for(let i=0;i<line.length-1;i+=1999)parts.push(line.slice(i,i+2000));return parts;
 });
}

// Reconstruct contiguous observation runs, not a dictionary keyed by segment ID:
// a legacy/restored recording may reuse an ID after another segment. Metadata
// is used only where present; coordinate-only legacy routes are not guessed at.
export function recordedRouteSegments(points,{automatic=false,fleet=false}={}){
 const segments=[];let run=[],previous=null;
 const flush=()=>{if(run.length)segments.push(run);run=[];};
 for(const point of points){
  if(!point || (point.timestamp!=null&&(!Number.isFinite(point.timestamp)||point.timestamp<0))){flush();previous=null;continue;}
  const coordinate=[point.latitude,point.longitude];
  if(!validDisplayPoint(coordinate)||(point.accuracy!=null&&(!Number.isFinite(point.accuracy)||point.accuracy<0||point.accuracy>65))){flush();previous=null;continue;}
  const timed=previous&&Number.isFinite(previous.timestamp)&&Number.isFinite(point.timestamp);
  const dt=timed?point.timestamp-previous.timestamp:0;
  if(timed&&dt<=0){flush();continue;}
  const distance=previous?displayMetres([previous.latitude,previous.longitude],coordinate):0;
  // Match the recorder's distinction between automatic stationary stops and
  // missing observations. This is presentation, never a repair of stored data.
  const gap=timed&&(fleet?dt>120:automatic?dt>180||(dt>45&&distance>Math.max(50,(previous.accuracy||0)+(point.accuracy||0))):dt>30);
  if(previous&&(point.segment!==previous.segment||gap||distance>MAX_DISPLAY_STEP_METRES||(timed&&distance/dt>120)))flush();
  run.push(coordinate);previous=point;
 }
 flush();return segments;
}
