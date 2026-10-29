// Route density for the Map overview: a personal heatmap of every eligible
// journey instead of one line, a Start and a Finish per journey.
//
// Each journey is walked through a grid of square cells (25 m to 1.6 km, one grid
// per zoom band). Consecutive cells it passes through form an edge. An edge is
// undirected (A→B and B→A are the same street) and counts each journey once, so
// a loop ridden twice in one journey, or GPS jitter wandering back and forth
// between two cells, does not inflate it. Snapping to cell centres absorbs GPS
// jitter and different sampling rates: two rides along the same road fall into
// the same cells even when their fixes never coincide. Edges are then chained
// into polylines per weight bucket, so the native map draws a handful of
// multi-polylines per zoom band instead of thousands of overlays.
//
// The raw journeys are never modified; this is a display aggregate.
import {displaySegments} from './mapGeometry.js';

export const DENSITY_CELLS=[25,100,400,1600];
export const DENSITY_BUCKETS=5;
// Input budget: beyond this many route points the oldest journeys are left out
// (and the map says so) rather than freezing the phone.
export const DENSITY_POINT_BUDGET=400000;
// A grid level with more edges than this is dropped; the next coarser one is
// shown at that zoom instead.
export const DENSITY_EDGE_LIMIT=60000;
// Consecutive fixes further apart than this are not joined: a straight line
// across unknown ground is never drawn as a travelled road.
const MAX_STEP_METRES=2000;
const METRES_PER_DEGREE=111320;

const valid=p=>Array.isArray(p)&&p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180&&!(p[0]===0&&p[1]===0);
function metres(a,b){
 const r=Math.PI/180,dlat=(b[0]-a[0])*r,dlon=(b[1]-a[1])*r;
 const x=Math.sin(dlat/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin(dlon/2)**2;
 return 6371000*2*Math.atan2(Math.sqrt(x),Math.sqrt(Math.max(0,1-x)));
}
// Rows are a fixed height in latitude; each row's columns are as wide in
// longitude as the cell is in metres at that row's latitude.
function cellOf(lat,lon,size){
 const height=size/METRES_PER_DEGREE;
 const row=Math.floor(lat/height);
 const rowLat=(row+0.5)*height;
 const width=size/(METRES_PER_DEGREE*Math.max(0.05,Math.cos(rowLat*Math.PI/180)));
 return `${row}:${Math.floor((lon+180)/width)}`;
}
function cellCentre(key,size){
 const [row,col]=key.split(':').map(Number);
 const height=size/METRES_PER_DEGREE;
 const rowLat=(row+0.5)*height;
 const width=size/(METRES_PER_DEGREE*Math.max(0.05,Math.cos(rowLat*Math.PI/180)));
 return [round(rowLat),round((col+0.5)*width-180)];
}
const round=value=>Math.round(value*1e5)/1e5;

// The set of undirected edges one journey passes through on one grid.
export function journeyEdges(segments,size){
 const edges=new Set();
 for(const segment of segments){
  let previousCell=null,previous=null;
  for(const point of segment){
   if(!valid(point))continue;
   if(previous&&metres(previous,point)>MAX_STEP_METRES){previousCell=null;previous=null;}
   // Step through the stretch at half a cell, so a fast or sparsely sampled
   // journey crosses the same cells as a densely sampled one.
   const steps=previous?Math.max(1,Math.ceil(metres(previous,point)/(size/2))):1;
   for(let i=1;i<=steps;i++){
    const t=i/steps;
    const lat=previous?previous[0]+(point[0]-previous[0])*t:point[0];
    const lon=previous?previous[1]+(point[1]-previous[1])*t:point[1];
    const cell=cellOf(lat,lon,size);
    if(previousCell&&cell!==previousCell)edges.add(previousCell<cell?`${previousCell}|${cell}`:`${cell}|${previousCell}`);
    previousCell=cell;
   }
   previous=point;
  }
 }
 return edges;
}

// Single traversals stay subtle (bucket 1); the most travelled paths reach the
// top bucket. Scaled on a log curve so a commute ridden 400 times does not
// flatten everything else, with a floor so a handful of journeys are not all
// drawn at full strength.
export function densityBucket(count,maxCount){
 if(count<=1)return 1;
 const t=Math.log2(count)/Math.log2(Math.max(6,maxCount));
 return Math.min(DENSITY_BUCKETS,1+Math.floor(Math.min(1,t)*(DENSITY_BUCKETS-0.001)));
}

// Chain edges of one bucket into as few polylines as possible.
function chain(edges,size){
 const byCell=new Map();
 edges.forEach(([a,b],index)=>{for(const cell of [a,b]){if(!byCell.has(cell))byCell.set(cell,[]);byCell.get(cell).push(index);}});
 const used=new Uint8Array(edges.length);
 const next=cell=>{const list=byCell.get(cell);if(!list||list.length!==2)return -1;const index=list.find(i=>!used[i]);return index===undefined?-1:index;};
 const lines=[];
 edges.forEach(([a,b],start)=>{
  if(used[start])return;
  used[start]=1;
  const line=[a,b];
  for(const forward of [true,false]){
   for(;;){
    const end=forward?line.at(-1):line[0];
    const index=next(end);
    if(index<0)break;
    used[index]=1;
    const [x,y]=edges[index];
    const other=x===end?y:x;
    if(forward)line.push(other);else line.unshift(other);
   }
  }
  lines.push(line.map(cell=>cellCentre(cell,size)));
 });
 return lines;
}

const journeyKey=j=>`${j.id}:${j.startedAt||''}:${(j.routeSegments||[j.route||[]]).reduce((n,s)=>n+s.length,0)}`;
// Per-journey edges are cached, so changing a filter or a new journey only
// computes what is new.
const edgeCache=new Map();
function cachedEdges(journey,segments,size){
 const key=`${size}|${journeyKey(journey)}`;
 let edges=edgeCache.get(key);
 if(!edges){
  edges=journeyEdges(segments,size);
  if(edgeCache.size>8000)edgeCache.clear();
  edgeCache.set(key,edges);
 }
 return edges;
}

// Percentile bounds of the density, so the camera frames where the user
// actually goes rather than one holiday on another continent.
function focusBounds(points){
 if(!points.length)return null;
 const lats=points.map(p=>p[0]).sort((a,b)=>a-b),lons=points.map(p=>p[1]).sort((a,b)=>a-b);
 const at=(list,q)=>list[Math.min(list.length-1,Math.max(0,Math.floor(q*(list.length-1))))];
 const trim=points.length>=40?0.02:0;
 return [at(lats,trim),at(lons,trim),at(lats,1-trim),at(lons,1-trim)];
}

// journeys: the journeys the map shows (already filtered), newest first or not.
export function routeDensity(journeys,{budget=DENSITY_POINT_BUDGET,cells=DENSITY_CELLS,edgeLimit=DENSITY_EDGE_LIMIT}={}){
 const ordered=[...journeys].sort((a,b)=>(b.startedAt||0)-(a.startedAt||0));
 const included=[];let points=0;
 for(const journey of ordered){
  const segments=displaySegments(journey,1500).map(s=>s.filter(valid)).filter(s=>s.length>1);
  const count=segments.reduce((n,s)=>n+s.length,0);
  if(!count)continue;
  if(points+count>budget&&included.length)break;
  points+=count;included.push({journey,segments});
 }
 const withRoutes=ordered.filter(j=>displaySegments(j,1500).some(s=>s.filter(valid).length>1)).length;
 const levels=[];
 let anchors=[];
 for(const size of cells){
  const counts=new Map();
  for(const {journey,segments} of included)for(const edge of cachedEdges(journey,segments,size))counts.set(edge,(counts.get(edge)||0)+1);
  if(counts.size>edgeLimit)continue;
  let maxCount=1;for(const value of counts.values())if(value>maxCount)maxCount=value;
  const grouped=Array.from({length:DENSITY_BUCKETS},()=>[]);
  for(const [edge,count] of [...counts].sort(([a],[b])=>a<b?-1:a>b?1:0))grouped[densityBucket(count,maxCount)-1].push(edge.split('|'));
  levels.push({cell:size,maxCount,buckets:grouped.map((edges,i)=>({weight:i+1,lines:chain(edges,size)})).filter(b=>b.lines.length)});
  if(size===cells.at(-1)||!anchors.length)anchors=[...counts.keys()].flatMap(edge=>edge.split('|').map(cell=>cellCentre(cell,size)));
 }
 return {levels,focus:focusBounds(anchors),included:included.length,total:withRoutes};
}

// A small stable hash, so the native map is sent the density once per change.
export function densityKey(journeys,extra=''){
 let hash=2166136261;
 const text=`${extra}#${journeys.map(journeyKey).sort().join(',')}`;
 for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}
 return `d${(hash>>>0).toString(36)}`;
}
