// Route density for the Map overview: a personal heatmap of every eligible
// journey instead of one line, a Start and a Finish per journey.
//
// The grid counts traversals; it is NOT display geometry. Each edge keeps an
// actual representative traversal, and lines join only consecutive pieces of
// that same traversal. Snapping drawing vertices to cell centres manufactures
// staircases on straight roads, especially where row-dependent columns shift.
//
// The raw journeys are never modified; this is a display aggregate.
import {displaySegments,displayMetres,MAX_DISPLAY_STEP_METRES} from './mapGeometry.js';

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
const MAX_STEP_METRES=MAX_DISPLAY_STEP_METRES;
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
const metres=displayMetres;
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
// Grid centres for counting/debug comparisons only; never drawing vertices.
export const edgePoints=(edge,size)=>edgeCells(edge).map(cell=>cellCentre(cell,size));
function edgeCells(edge){
 const code=((edge%64)+64)%64,low=(edge-code)/64;
 const dr=code>=33?1:0,dc=code-dr*33-16;
 return [low,low+dr*ROW+dc];
}
const round=value=>Math.round(value*1e5)/1e5;

// Walk observed stretches at half-cell intervals for counting, while retaining
// coordinates on those stretches. Inserted points subdivide an existing line;
// they never estimate a road, bend a path or span a gap.
function journeyTrace(segments,size,maxEdges=Infinity){
 const pieces=[],seen=new Set();let index=0,runIndex=0;
 for(const run of validRuns(segments)){
  let previous=null,previousCell=null,pending=[],lastPiece=null;
  const finish=()=>{if(lastPiece)lastPiece.line.push(...pending.slice(1));pending=[];lastPiece=null;runIndex++;};
  for(const point of run){
   let distance=previous?metres(previous,point):0;
   if(distance>MAX_STEP_METRES){finish();previous=null;previousCell=null;distance=0;}
   const steps=previous?Math.max(1,Math.ceil(distance/(size/2))):1;
   const origin=previous;
   for(let i=1;i<=steps;i++){
    const t=i/steps;
    const p=origin&&i<steps?[origin[0]+(point[0]-origin[0])*t,origin[1]+(point[1]-origin[1])*t]:point;
    const cell=cellOf(p[0],p[1],size);
    pending.push(p);
    if(previousCell!==null&&cell!==previousCell){
     const edge=edgeOf(previousCell,cell);
     lastPiece=null;
     if(edge!==null&&!seen.has(edge)){
      seen.add(edge);if(seen.size>maxEdges)return null;
      lastPiece={edge,line:pending,index,run:runIndex};pieces.push(lastPiece);
     }
     index++;
     pending=[p];
    }
    previousCell=cell;
   }
   previous=point;
  }
  finish();
 }
 return pieces;
}
export function journeyEdges(segments,size){return new Set(journeyTrace(segments,size).map(piece=>piece.edge));}

// Single traversals stay subtle (bucket 1); the most travelled paths reach the
// top bucket. Scaled on a log curve so a commute ridden 400 times does not
// flatten everything else, with a floor so a handful of journeys are not all
// drawn at full strength.
export function densityBucket(count,maxCount){
 if(count<=1)return 1;
 const t=Math.log2(count)/Math.log2(Math.max(6,maxCount));
 return Math.min(DENSITY_BUCKETS,1+Math.floor(Math.min(1,t)*(DENSITY_BUCKETS-0.001)));
}

// Only consecutive pieces from the same observed run may share a line. An
// arbitrary graph walk through a grid junction can connect different journeys.
// Split before MapKit's 5000-point safety cap, repeating the boundary vertex.
function representativeLines(pieces){
 const lines=[];let line=null,previous=null;
 for(const piece of pieces){
  const adjacent=previous&&piece.owner===previous.owner&&piece.run===previous.run&&piece.index===previous.index+1&&
   line.at(-1)[0]===piece.line[0][0]&&line.at(-1)[1]===piece.line[0][1];
  if(!adjacent){line=[];lines.push(line);}
  for(const point of adjacent?piece.line.slice(1):piece.line){
   if(line.length>=4900){line=[line.at(-1)];lines.push(line);}
   line.push(point);
  }
  previous=piece;
 }
 return lines.filter(line=>line.length>1);
}

// A journey's identity for caching: its id, start, and a hash of its route
// content. Edits that move points without changing how many there are (or that
// only change the visible range) therefore never reuse old edges or highlight
// geometry. The hash is computed once per route array (journey objects are
// replaced, not mutated, when a journey changes), so re-renders cost nothing.
const signatures=new WeakMap();
export function routeSignature(journey){
 const route=journey?.routeSegments?.length?journey.routeSegments:journey?.route;
 if(!Array.isArray(route))return '0';
 let signature=signatures.get(route);
 if(signature===undefined){
  let hash=2166136261,count=0;
  const mix=value=>{hash^=value;hash=Math.imul(hash,16777619);};
  for(const segment of route===journey.routeSegments?route:[route]){
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
// Cache observed traversals, bounded by retained coordinate references as well
// as entry count. Fine-grid interpolation must not accumulate unbounded history
// when users switch filters or zoom bands.
const traceCache=new Map();
const TRACE_CACHE_POINTS=900000;
let cachedPoints=0;
function cachedTrace(journey,segments,size,edgeLimit){
 const key=`${size}|${journeyKey(journey)}`;
 const cached=traceCache.get(key);
 if(cached)return cached.pieces.length>edgeLimit?null:cached.pieces;
 const pieces=journeyTrace(segments,size,edgeLimit);
 if(!pieces)return null;
 const points=pieces.reduce((n,p)=>n+p.line.length,0);
 while(traceCache.size&&(cachedPoints+points>TRACE_CACHE_POINTS||traceCache.size>=8000)){
  const oldest=traceCache.keys().next().value;cachedPoints-=traceCache.get(oldest).points;traceCache.delete(oldest);
 }
 if(points<=TRACE_CACHE_POINTS){traceCache.set(key,{pieces,points});cachedPoints+=points;}
 return pieces;
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
 levelsLoop: for(const size of cells){
  const counts=new Map(),representatives=new Map();
  for(const {journey,segments} of included){
   const visited=new Set();
   const trace=cachedTrace(journey,segments,size,edgeLimit);
   if(!trace)continue levelsLoop;
   for(const piece of trace){
    if(visited.has(piece.edge))continue;
    visited.add(piece.edge);
    counts.set(piece.edge,(counts.get(piece.edge)||0)+1);
    if(counts.size>edgeLimit)continue levelsLoop;
    if(!representatives.has(piece.edge))representatives.set(piece.edge,{...piece,owner:journeyKey(journey)});
   }
  }
  if(counts.size>edgeLimit)continue;
  let maxCount=1;for(const value of counts.values())if(value>maxCount)maxCount=value;
  const grouped=Array.from({length:DENSITY_BUCKETS},()=>[]);
  // Map insertion order follows newest journeys and their traversal order,
  // making the representative choice deterministic across filter/data ordering.
  for(const [edge,piece] of representatives)grouped[densityBucket(counts.get(edge),maxCount)-1].push(piece);
  const buckets=grouped.map((pieces,i)=>({weight:i+1,lines:representativeLines(pieces)})).filter(b=>b.lines.length);
  // Avoid native prefix truncation; use the next coarser level instead.
  if(buckets.some(bucket=>bucket.lines.length>40000))continue;
  levels.push({cell:size,maxCount,buckets});
  if(size===cells.at(-1)||!anchors.length)anchors=[...representatives.values()].flatMap(piece=>[piece.line[0],piece.line.at(-1)]);
 }
 return {levels,focus:focusBounds(anchors),included:included.length,total,points};
}

// A small stable hash, so the native map is sent the density once per change.
export function densityKey(journeys,extra=''){
 let hash=2166136261;
 const text=`geometry-v2|${extra}#${journeys.map(journeyKey).sort().join(',')}`;
 for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}
 return `d${(hash>>>0).toString(36)}`;
}
