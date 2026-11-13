import {thinLine} from './mapContent.js';
import {distanceMetres} from './householdLocation.js';

// Keep composition, access checks and saved geometry in personDay. This projection
// only changes which authorised activity is visible and how its existing line looks.
export function filterPersonDay(day,activity){
 if(!activity)return day;
 const activities=day.activities.filter(a=>a.activity===activity);
 const ids=new Set(activities.map(a=>a.id));
 const samples=day.samples.filter(s=>ids.has(s.id)).map(s=>({...s,nextSame:-1}));
 const next=new Map();
 for(let i=samples.length-1;i>=0;i--){samples[i].nextSame=next.get(samples[i].id)??-1;next.set(samples[i].id,i);}
 return {...day,activities,samples,runs:undefined,markers:day.markers.filter(m=>ids.has(m.activityID)),recorded:activities.flatMap(a=>a.routes),untimed:activities.filter(a=>a.untimed).flatMap(a=>a.routes),estimated:activities.flatMap(a=>a.roads.map(r=>r.line)),live:[],liveRoads:[],isEmpty:!activities.length};
}
// At most 500 saved overlays / 120k vertices, rather than thinning every line
// before slicing it. Round-robin allocation prevents a fragmented early recording
// from using the entire budget. Up to 480 activity flags leave room for live pins.
export const PERSON_ROUTE_LIMIT=500,PERSON_VERTEX_LIMIT=120000,PERSON_ACTIVITY_LIMIT=480;
function displayActivities(day,selected){
 const picked=day.activities.find(a=>a.id===selected);
 const others=day.activities.filter(a=>a!==picked);
 const slots=PERSON_ACTIVITY_LIMIT-(picked?1:0);
 const sampled=others.length>slots?Array.from({length:slots},(_,i)=>others[Math.floor(i*(others.length-1)/Math.max(1,slots-1))]):others;
 return picked?[picked,...sampled]:sampled;
}
export function personRoutes(day,selected){
 const activities=displayActivities(day,selected);
 const cursors=activities.map(a=>({a,index:0})),allocated=[];
 const take=cursor=>{
  const {a}=cursor;
  while(cursor.index<a.routes.length+a.roads.length){
   const index=cursor.index++,recorded=index<a.routes.length;
   const line=recorded?a.routes[index]:a.roads[index-a.routes.length].line;
   if(line.length>1){allocated.push({line,activityID:a.id,color:recorded?'accent':'#F29927'});return true;}
  }
  return false;
 };
 // First represent every chosen activity; then give the selected recording the
 // remaining budget before fairly distributing any spare capacity.
 for(const cursor of cursors)take(cursor);
 const priority=cursors.find(cursor=>cursor.a.id===selected);
 if(priority)while(allocated.length<PERSON_ROUTE_LIMIT&&take(priority)){ /* bounded by the overlay budget */ }
 let remaining=true;
 while(remaining&&allocated.length<PERSON_ROUTE_LIMIT){
  remaining=false;
  for(const cursor of cursors){
   if(take(cursor))remaining=true;
   if(allocated.length===PERSON_ROUTE_LIMIT)break;
  }
 }
 const pointsPerLine=Math.min(1500,Math.floor(PERSON_VERTEX_LIMIT/Math.max(1,allocated.length)));
 return allocated.map(({line,activityID,color})=>({points:thinLine(line,pointsPerLine),activityID,color,width:selected===activityID?7:6,opacity:1}))
  .sort((a,b)=>Number(a.activityID===selected)-Number(b.activityID===selected));
}
// Retain endpoints while bounding playback/live display data too. Extremely
// fragmented streams are sampled across their extent rather than cut at the front.
export function boundedPersonLines(lines,limit=750,vertices=120000){
 const visible=lines.filter(line=>line.length>1);
 const chosen=visible.length>limit?Array.from({length:limit},(_,i)=>visible[Math.floor(i*(visible.length-1)/(limit-1))]):visible;
 const points=Math.min(1500,Math.floor(vertices/Math.max(1,chosen.length)));
 return chosen.map(line=>thinLine(line,points));
}
export function personFlags(day,routes,selected){
 const visible=new Set(routes.map(r=>r.activityID));
 // A real single-fix start still deserves a flag even though it cannot draw a line.
 for(const a of displayActivities(day,selected))if(!a.routes.some(r=>r.length>1)&&!a.roads.some(r=>r.line.length>1))visible.add(a.id);
 return day.markers.filter(m=>visible.has(m.activityID)).map(m=>({id:'step:'+m.activityID,kind:'step',point:m.point,title:m.title,label:String(m.n),activityID:m.activityID,selected:m.activityID===selected}));
}
// Observed distance only: never connect GPS gaps, redacted stretches or activities.
// A day can contain only part of a drive, so this is labelled "recorded", not a total.
export function recordedDistance(activity){
 let total=0;
 for(const line of activity.routes)for(let i=1;i<line.length;i++)total+=distanceMetres({latitude:line[i-1][0],longitude:line[i-1][1]},{latitude:line[i][0],longitude:line[i][1]});
 return total;
}
