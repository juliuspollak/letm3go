// A person's live trail: [latitude, longitude, t (epoch seconds), segment] points.
// Batches arrive late, twice and out of order; merging is by time, so applying the
// same batch again, or in any order, gives the same trail.
export const TRAIL_LIMIT=3000;
const valid=p=>Array.isArray(p)&&p.length>=4&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&Number.isFinite(p[2])&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180;
// Bounded without losing the start of a long drive: past the limit the OLDER half is
// thinned (every second point, keeping both ends of each GPS segment) until it fits,
// so recent movement stays at full resolution and the whole timeline stays present.
// The server applies the same rule (compact_trail), so both sides agree.
export function compactTrail(points,limit=TRAIL_LIMIT){
 let list=points;
 for(let guard=0;list.length>limit&&guard<6;guard++){
  const half=Math.floor(list.length/2);
  const older=list.slice(0,half).filter((p,i,all)=>i%2===0||all[i-1]?.[3]!==p[3]||all[i+1]?.[3]!==p[3]);
  list=[...older,...list.slice(half)];
 }
 return list.length>limit?list.slice(-limit):list;
}
export function mergeTrail(existing=[],incoming=[],limit=TRAIL_LIMIT){
 const byTime=new Map();
 for(const p of existing)if(valid(p))byTime.set(p[2],p);
 for(const p of incoming)if(valid(p))byTime.set(p[2],p);
 return compactTrail([...byTime.values()].sort((a,b)=>a[2]-b[2]),limit);
}
// What to ask the server for next: only points newer than the ones held.
export const newestTime=trail=>trail.length?trail.at(-1)[2]:0;
// Drawable lines: a new segment number is a genuine GPS gap, never joined.
export function trailLines(trail){
 const lines=[];let segment=null;
 for(const p of trail){
  if(!valid(p))continue;
  if(!lines.length||p[3]!==segment){lines.push([]);segment=p[3];}
  lines.at(-1).push([p[0],p[1]]);
 }
 return lines.filter(line=>line.length>1);
}
