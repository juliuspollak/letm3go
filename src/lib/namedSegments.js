import {newUUID} from './uuid.js';
// Named segments: sections of one recording, referenced by its own GPS fix
// indices. The native recorder (NamedSegmentCore.swift) validates and stores
// them; this mirrors its rules for the live editor, so what the editor shows is
// what will be saved. Nothing here changes the recording or its visible route.
export const SEGMENT_ACTIVITIES=['MTB','Cycling','Road cycling','Hiking','Walking','Running'];
export const SEGMENT_MIN_POINTS=5;
export const SEGMENT_MIN_METRES=50;
export const SEGMENT_NAME_MAX=80;
export const SEGMENT_LIMIT=20;
// Distinct from the blue route and from each other, legible on light and dark
// maps; a segment keeps its colour index for life.
export const SEGMENT_COLORS=['#E4572E','#17A398','#F2A541','#8E44AD','#2E86DE','#C0392B','#27AE60','#D35400'];
export const SELECTION_COLOR='#FF2D55';
export const segmentColor=index=>SEGMENT_COLORS[((Number(index)||0)%SEGMENT_COLORS.length+SEGMENT_COLORS.length)%SEGMENT_COLORS.length];
const LOCAL_SOURCES=['device','simulator','watch'];

const rad=Math.PI/180;
export function metres(a,b){const dlat=(b.latitude-a.latitude)*rad,dlon=(b.longitude-a.longitude)*rad,x=Math.sin(dlat/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin(dlon/2)**2;return 6371000*2*Math.atan2(Math.sqrt(x),Math.sqrt(Math.max(0,1-x)));}
// RecordedActivity.unobservedGap: a silence over 45 s with real displacement,
// or over 180 s, is not route.
function unobservedGap(a,b){const dt=b.timestamp-a.timestamp;if(dt<=45)return false;if(dt>180)return true;return metres(a,b)>Math.max(50,(a.accuracy||0)+(b.accuracy||0));}
export const connected=(a,b)=>(a.segment??0)===(b.segment??0)&&b.timestamp>a.timestamp&&!unobservedGap(a,b);
const usable=p=>p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Number.isFinite(p.timestamp);

// Recorded walks, runs, hikes and rides with real GPS, stored on this iPhone.
export function canCreateSegments(trip){
 return !!trip&&LOCAL_SOURCES.includes(trip.source)&&trip.state==='finished'&&SEGMENT_ACTIVITIES.includes(trip.activity)&&
  !['tesla','historical'].includes(trip.recordingMode)&&Array.isArray(trip.points)&&trip.points.filter(usable).length>=SEGMENT_MIN_POINTS;
}

// Observed stretches between two fix indices; a gap is never bridged.
export function segmentRuns(points,start,end){
 const runs=[];let previous=null;
 for(let i=Math.max(0,start);i<=Math.min(points.length-1,end);i++){
  const p=points[i];if(!usable(p))continue;
  if(previous&&connected(previous,p))runs.at(-1).push(p);else runs.push([p]);
  previous=p;
 }
 return runs;
}

// RecordedActivity.measuredDistance, per observed stretch.
function stretchDistance(run,automatic){
 let total=0;
 for(let i=1;i<run.length;i++){
  const a=run[i-1],b=run[i],dt=b.timestamp-a.timestamp,d=metres(a,b);
  if(dt<=0)continue;
  if(!automatic){total+=d;continue;}
  const floor=Math.max(3,Math.min(10,((a.accuracy||0)+(b.accuracy||0))/4));
  if(d/dt>=0.35&&d>=floor)total+=d;
 }
 return total;
}

export function segmentStats(trip,start,end){
 const points=trip.points||[];
 if(!(start>=0&&end<points.length&&start<end))return {valid:false,problem:'range',distanceMeters:0,durationSeconds:0,gapSeconds:0,pointCount:0};
 const runs=segmentRuns(points,start,end);
 const automatic=trip.recordingMode==='automatic';
 const distanceMeters=runs.reduce((sum,run)=>sum+stretchDistance(run,automatic),0);
 let gapSeconds=0;
 for(let i=start+1;i<=end;i++){const a=points[i-1],b=points[i];if(usable(a)&&usable(b)&&!connected(a,b))gapSeconds+=Math.max(0,b.timestamp-a.timestamp);}
 const pointCount=end-start+1;
 const durationSeconds=Math.max(0,(points[end]?.timestamp??0)-(points[start]?.timestamp??0));
 const problem=pointCount<SEGMENT_MIN_POINTS?'points':!runs.some(run=>run.length>1)?'route':distanceMeters<SEGMENT_MIN_METRES?'short':null;
 return {valid:!problem,problem,distanceMeters,durationSeconds,gapSeconds,pointCount};
}
export function segmentProblem(problem){
 return problem==='points'?`Drag the handles further apart: a segment needs at least ${SEGMENT_MIN_POINTS} GPS points.`
  :problem==='short'?`Drag the handles further apart: a segment must cover at least ${SEGMENT_MIN_METRES} m.`
  :problem==='route'?'This section has no continuous GPS route.':problem==='range'?'Choose a start before the finish.':'';
}
export function cleanSegmentName(value){
 const name=String(value??'').trim().replace(/\s+/g,' ');
 return name&&name.length<=SEGMENT_NAME_MAX?name:null;
}

// The saved segments of a trip that still name their own fixes.
export function namedSegments(trip){
 const points=trip?.points||[];
 return (trip?.details?.namedSegments||[]).filter(s=>Number.isInteger(s.startIndex)&&Number.isInteger(s.endIndex)&&s.startIndex<s.endIndex&&s.endIndex<points.length&&
  points[s.startIndex]?.timestamp===s.startTimestamp&&points[s.endIndex]?.timestamp===s.endTimestamp);
}

const line=run=>run.map(p=>[p.latitude,p.longitude]);
// The fix halfway along a segment's observed route, for its label.
function labelPoint(runs){
 const all=runs.filter(run=>run.length>1).flat();
 return all.length?[all[Math.floor(all.length/2)].latitude,all[Math.floor(all.length/2)].longitude]:null;
}

// Map layers for the activity map. `selection` ({start,end}) is the section
// being chosen in the editor: then the whole recording is muted and the
// selection is drawn above everything. Saved segments are drawn in their own
// colours with a label; `editingID` hides the one being edited.
export function segmentLayers(trip,{selection=null,editingID=null}={}){
 const points=trip?.points||[];
 const styled=[],pins=[];
 for(const segment of namedSegments(trip)){
  if(segment.id===editingID)continue;
  const runs=segmentRuns(points,segment.startIndex,segment.endIndex).filter(run=>run.length>1);
  const color=segmentColor(segment.colorIndex);
  for(const run of runs)styled.push({points:line(run),color,width:selection?4:6});
  const at=labelPoint(runs);
  if(at)pins.push({point:at,title:segment.name,kind:'segment',color,id:`segment:${segment.id}`});
 }
 if(selection){
  for(const run of segmentRuns(points,selection.start,selection.end).filter(run=>run.length>1))styled.push({points:line(run),color:SELECTION_COLOR,width:7});
 }
 return {styled,pins,muted:!!selection};
}

export function newSegmentID(){
 return newUUID();
}

// Segments a destructive trim to start...end would delete (RouteTrimming.segmentsCut).
// Any caller of recorder.trimActivity must list these names and pass
// confirmSegmentRemoval only after the person agrees; the native recorder
// refuses otherwise. The Activity page itself never trims destructively: it
// uses the non-destructive visible route window (setRouteDisplay).
export function segmentsCutByTrim(trip,start,end){
 return (trip?.details?.namedSegments||[]).filter(s=>s.startIndex<start||s.endIndex>end);
}
