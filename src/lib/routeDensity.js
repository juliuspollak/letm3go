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

export const validPoint=p=>Array.isArray(p)&&p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180&&!(p[0]===0&&p[1]===0);
// An invalid sample (missing, NaN, out of range, 0,0) ends the stretch: the
// valid points on either side are never joined across it.
export function validRuns(segments){
 const runs=[];
 for(const segment of segments||[]){
  let run=[];
  for(const point of Array.isArray(segment)?segment:[]){
   if(validPoint(point))run.push(point);
   else{if(run.length>1)runs.push(run);run=[];}
  }
  if(run.length>1)runs.push(run);
 }
 return runs;
}
// Equirectangular distance: exact enough for steps of at most a few km, and far
// cheaper than haversine on hundreds of thousands of points.
function metres(a,b){
 const dlat=(b[0]-a[0])*METRES_PER_DEGREE;
 const dlon=(b[1]-a[1])*METRES_PER_DEGREE*Math.cos((a[0]+b[0])*Math.PI/360);
 return Math.sqrt(dlat*dlat+dlon*dlon);
}
// Rows are a fixed height in latitude; each row's columns are as wide in
// longitude as the cell is in metres at that row's latitude.
const widths=new Map();
function columnWidth(row,size){
 const key=row*8+DENSITY_CELLS.indexOf(size);
 let width=widths.get(key);
 if(width===undefined){
  const rowLat=(row+0.5)*size/METRES_PER_DEGREE;
  width=size/(METRES_PER_DEGREE*Math.max(0.05,Math.cos(rowLat*Math.PI/180)));
  if(widths.size>200000)widths.clear();
  widths.set(key,width);
 }
 return width;
}
// Cells and edges are plain numbers (no string per step): a cell is
// row·2²² + column, and an edge is its lower cell ·64 + the direction to the
// other cell. Half-cell steps only ever reach a neighbouring row, and rows'
// columns drift by a few at most, so every edge fits the direction code.
const ROW=4194304;
function cellOf(lat,lon,size){
 const row=Math.floor(lat/(size/METRES_PER_DEGREE));
 return row*ROW+Math.floor((lon+180)/columnWidth(row,size));
}
function cellCentre(cell,size){
 const row=Math.floor(cell/ROW),col=cell-row*ROW;
 return [round((row+0.5)*size/METRES_PER_DEGREE),round((col+0.5)*columnWidth(row,size)-180)];
}
function edgeOf(a,b){
 const low=Math.min(a,b),high=Math.max(a,b);
 const lowRow=Math.floor(low/ROW),highRow=Math.floor(high/ROW);
 const dr=highRow-lowRow,dc=(high-highRow*ROW)-(low-lowRow*ROW);
 if(dr>1||dc<-16||dc>16)return null;
 return low*64+dr*33+dc+16;
}
// The centres of an edge's two cells (for tests and focus bounds).
export const edgePoints=(edge,size)=>edgeCells(edge).map(cell=>cellCentre(cell,size));
function edgeCells(edge){
 const code=((edge%64)+64)%64,low=(edge-code)/64;
 const dr=code>=33?1:0,dc=code-dr*33-16;
 return [low,low+dr*ROW+dc];
}
const round=value=>Math.round(value*1e5)/1e5;

// The set of undirected edges one journey passes through on one grid.
export function journeyEdges(segments,size){
 const edges=new Set();
 for(const run of validRuns(segments)){
  let previousCell=null,previous=null;
  for(const point of run){
   const distance=previous?metres(previous,point):0;
   if(distance>MAX_STEP_METRES){previousCell=null;previous=null;}
   // Step through the stretch at half a cell, so a fast or sparsely sampled
   // journey crosses the same cells as a densely sampled one.
   const steps=previous?Math.max(1,Math.ceil(distance/(size/2))):1;
   for(let i=1;i<=steps;i++){
    const t=i/steps;
    const cell=previous?cellOf(previous[0]+(point[0]-previous[0])*t,previous[1]+(point[1]-previous[1])*t,size):cellOf(point[0],point[1],size);
    if(previousCell!==null&&cell!==previousCell){const edge=edgeOf(previousCell,cell);if(edge!==null)edges.add(edge);}
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

// Chain the edges of one bucket into few polylines. A chain carries on through
// junctions along any unused edge (consecutive points always share a cell), so
// a dense network is a few long lines rather than one line per street piece.
function chain(edges,size){
 const byCell=new Map();
 edges.forEach(([a,b],index)=>{for(const cell of [a,b]){let list=byCell.get(cell);if(!list){list=[];byCell.set(cell,list);}list.push(index);}});
 const used=new Uint8Array(edges.length);
 const cursor=new Map();
 const next=cell=>{
  const list=byCell.get(cell);
  let i=cursor.get(cell)||0;
  while(i<list.length&&used[list[i]])i++;
  cursor.set(cell,i);
  return i<list.length?list[i]:-1;
 };
 const walk=from=>{
  const cells=[];
  for(let end=from;;){
   const index=next(end);
   if(index<0)return cells;
   used[index]=1;
   const [x,y]=edges[index];
   end=x===end?y:x;
   cells.push(end);
  }
 };
 const lines=[];
 edges.forEach(([a,b],start)=>{
  if(used[start])return;
  used[start]=1;
  const forward=walk(b),backward=walk(a);
  const cells=[...backward.reverse(),a,b,...forward];
  lines.push(cells.map(cell=>cellCentre(cell,size)));
 });
 return lines;
}

// A journey's identity for caching: its id, start, and a hash of its route
// content. Edits that move points without changing how many there are (or that
// only change the visible range) therefore never reuse old edges or highlight
// geometry. The hash is computed once per route array (journey objects are
// replaced, not mutated, when a journey changes), so re-renders cost nothing.
const signatures=new WeakMap();
export function routeSignature(journey){
 const route=journey?.routeSegments||journey?.route;
 if(!Array.isArray(route))return '0';
 let signature=signatures.get(route);
 if(signature===undefined){
  let hash=2166136261,count=0;
  const mix=value=>{hash^=value;hash=Math.imul(hash,16777619);};
  for(const segment of journey.routeSegments?route:[route]){
   mix(0x9e37);
   for(const point of Array.isArray(segment)?segment:[]){
    count++;
    if(!Array.isArray(point)){mix(0x51ed);continue;}
    mix(Number.isFinite(point[0])?Math.round(point[0]*1e6)|0:0x7fff);
    mix(Number.isFinite(point[1])?Math.round(point[1]*1e6)|0:0x7ffe);
   }
  }
  signature=`${count}.${(hash>>>0).toString(36)}`;
  signatures.set(route,signature);
 }
 return signature;
}
export const journeyKey=j=>`${j.id}:${j.startedAt||''}:${j.signature||routeSignature(j)}`;
// Per-journey edges are cached by that key, so changing a filter or adding a
// journey only computes what is new.
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

// The display route of a journey, split at invalid samples.
export const densitySegments=journey=>validRuns(displaySegments(journey,1500));

// journeys: the journeys the map shows (already filtered), newest first or not.
export function routeDensity(journeys,{budget=DENSITY_POINT_BUDGET,cells=DENSITY_CELLS,edgeLimit=DENSITY_EDGE_LIMIT}={}){
 const ordered=[...journeys].sort((a,b)=>(b.startedAt||0)-(a.startedAt||0)||String(a.id).localeCompare(String(b.id)));
 // The most recent journeys up to the budget; once it is reached, older ones
 // are only counted, so the map can say how many are left out.
 const included=[];let points=0,total=0,full=false;
 for(const journey of ordered){
  const segments=densitySegments(journey);
  const count=segments.reduce((n,s)=>n+s.length,0);
  if(!count)continue;
  total++;
  if(full||(points+count>budget&&included.length)){full=true;continue;}
  points+=count;included.push({journey,segments});
 }
 const levels=[];
 let anchors=[];
 for(const size of cells){
  const counts=new Map();
  for(const {journey,segments} of included)for(const edge of cachedEdges(journey,segments,size))counts.set(edge,(counts.get(edge)||0)+1);
  if(counts.size>edgeLimit)continue;
  let maxCount=1;for(const value of counts.values())if(value>maxCount)maxCount=value;
  const grouped=Array.from({length:DENSITY_BUCKETS},()=>[]);
  for(const [edge,count] of [...counts].sort(([a],[b])=>a-b))grouped[densityBucket(count,maxCount)-1].push(edgeCells(edge));
  levels.push({cell:size,maxCount,buckets:grouped.map((edges,i)=>({weight:i+1,lines:chain(edges,size)})).filter(b=>b.lines.length)});
  if(size===cells.at(-1)||!anchors.length)anchors=[...counts.keys()].flatMap(edge=>edgeCells(edge).map(cell=>cellCentre(cell,size)));
 }
 return {levels,focus:focusBounds(anchors),included:included.length,total,points};
}

// A small stable hash, so the native map is sent the density once per change.
export function densityKey(journeys,extra=''){
 let hash=2166136261;
 const text=`${extra}#${journeys.map(journeyKey).sort().join(',')}`;
 for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}
 return `d${(hash>>>0).toString(36)}`;
}
