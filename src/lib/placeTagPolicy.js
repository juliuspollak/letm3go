import {activityCode} from './activityNames.js';
// Conservative, activity-aware location tagging. Search samples are NOT saved tags.
const outdoor=new Set(['Hiking','Walking','Running','Cycling','MTB','Road cycling','Mountain biking']);
const generic=new Set(['Shopping','Food','Outdoors','Nature','Park','Unknown location','Unnamed stop']);
export function placeTagPolicy(activity){
 if(activity==='Driving'||activity==='Unknown')return {limit:3,route:false,minimum:4};
 if(activity==='Kitesurfing')return {limit:4,route:true,minimum:3};
 if(outdoor.has(activityCode(activity)))return {limit:6,route:true,minimum:3};
 return {limit:3,route:false,minimum:4};
}
export function rankPlaceCandidates(candidates,{activity='Unknown',hidden=[],existing=[],limit}={}){
 const policy=placeTagPolicy(activity);
 const excluded=new Set([...hidden,...existing].map(x=>String(x).trim().toLocaleLowerCase()));
 const unique=new Map();
 for(const raw of candidates){
  const name=String(raw?.name||'').trim();if(!name||name.length>50||excluded.has(name.toLocaleLowerCase()))continue;
  const kind=raw.kind||'route';
  // Names of destinations and verified saved places outrank generic categories.
  const specific=!generic.has(name)&&!generic.has(raw.category||'');
  if(!specific&&kind==='route')continue;
  if(!policy.route&&kind==='route')continue;
  const score=(kind==='saved'?8:kind==='destination'?7:kind==='stop'?6:kind==='start'?4:2)+(specific?3:0);
  if(score<policy.minimum)continue;
  const key=name.toLocaleLowerCase();
  if(!unique.has(key)||unique.get(key).score<score)unique.set(key,{...raw,name,score});
 }
 return [...unique.values()].sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name)).slice(0,limit??policy.limit);
}
