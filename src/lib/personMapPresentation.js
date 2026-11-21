import {thinLine} from './mapContent.js';
import {distanceMetres} from './householdLocation.js';
import {formatDuration} from './peopleMap.js';

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
 return allocated.map(({line,activityID,color})=>({points:thinLine(line,pointsPerLine),activityID,color,width:selected===activityID?4.5:3.5,opacity:1}))
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
// Where along a line its number sits. The number goes ON the activity's own line, away from the
// shared start (home, a car park) where every trip begins, and the spot is chosen per activity so
// two trips over the same road do not put their numbers on top of each other.
const ANCHOR_FRACTIONS=[.5,.4,.6,.3,.7,.2,.8];
const ANCHOR_CROWDED_METRES=120;
// Street-scale flat distance: placing a number needs metres, not haversine accuracy, and runs for every activity.
const flat=(a,b)=>{const dy=(a[0]-b[0])*111320,dx=(a[1]-b[1])*111320*Math.cos((a[0]+b[0])*Math.PI/360);return Math.hypot(dx,dy);};
function pointAtFraction(line,cumulative,fraction){
 const target=cumulative.at(-1)*fraction;
 let i=1;while(i<cumulative.length-1&&cumulative[i]<target)i++;
 const span=cumulative[i]-cumulative[i-1],t=span>0?(target-cumulative[i-1])/span:0;
 return [line[i-1][0]+(line[i][0]-line[i-1][0])*t,line[i-1][1]+(line[i][1]-line[i-1][1])*t];
}
export function badgeAnchors(lines,placed=[]){
 // The longest drawn line stands for the activity.
 let best=null,bestLength=0;
 for(const line of lines){
  const cumulative=[0];
  for(let i=1;i<line.length;i++)cumulative.push(cumulative[i-1]+flat(line[i-1],line[i]));
  if(cumulative.at(-1)>bestLength){bestLength=cumulative.at(-1);best={line,cumulative};}
 }
 if(!best||bestLength<=0)return null;
 let choice=null,choiceGap=-1;
 for(const fraction of ANCHOR_FRACTIONS){
  const point=pointAtFraction(best.line,best.cumulative,fraction);
  let gap=Infinity;
  for(const other of placed)gap=Math.min(gap,flat(point,other));
  // The first spot that is clear of every earlier number wins; otherwise the clearest one.
  if(gap>=ANCHOR_CROWDED_METRES){choice=point;break;}
  if(gap>choiceGap){choiceGap=gap;choice=point;}
 }
 return choice;
}
// "08:05" style time for a badge or label, in the viewer's zone.
export function clockText(seconds,timeZone){
 try{return new Date(seconds*1000).toLocaleTimeString([],{hour:'numeric',minute:'2-digit',timeZone}).replace(/\s?([AP])M$/i,(m,x)=>x.toLowerCase()+'m').replace(/\s/g,'');}catch{return '';}
}
// A person standing somewhere the server did not name ("At a place") still has a "here since": the end of their last
// recorded activity today is when they arrived. Added to their bubble only when it has no label of its own (a label
// already says speed, a saved place or Home) and they are not moving.
export function withTimeHere(pin,day,nowMs){
 if(!pin||pin.label||pin.kind!=='people'||!Array.isArray(pin.members)||pin.members.length!==1)return pin;
 const member=pin.members[0];
 if(member.state!=='live'||!['stationary','unknown'].includes(member.activity))return pin;
 let since=null;
 for(const a of day?.activities||[]){
  const end=Number.isFinite(a.startedAt)&&Number.isFinite(a.durationSeconds)?a.startedAt+a.durationSeconds:null;
  if(end!=null&&(since==null||end>since))since=end;
 }
 const seconds=since==null?null:Math.round(nowMs/1000-since);
 if(seconds==null||seconds<60||seconds>86400)return pin;
 return {...pin,label:`Here · ${formatDuration(seconds)}`,labelKind:'place'};
}
export function personFlags(day,routes,selected,timeZone){
 const visible=new Set(routes.map(r=>r.activityID));
 // A real single-fix start still deserves a flag even though it cannot draw a line.
 for(const a of displayActivities(day,selected))if(!a.routes.some(r=>r.length>1)&&!a.roads.some(r=>r.line.length>1))visible.add(a.id);
 const linesOf=new Map();
 for(const r of routes){if(!linesOf.has(r.activityID))linesOf.set(r.activityID,[]);linesOf.get(r.activityID).push(r.points);}
 const startOf=new Map((day.activities||[]).map(a=>[a.id,a.startedAt]));
 const placed=[];
 return day.markers.filter(m=>visible.has(m.activityID)).map(m=>{
  const anchor=linesOf.has(m.activityID)?badgeAnchors(linesOf.get(m.activityID),placed):null;
  if(anchor)placed.push(anchor);
  const started=startOf.get(m.activityID),time=started!=null&&timeZone?clockText(started,timeZone):'';
  return {id:'step:'+m.activityID,kind:'step',point:anchor||m.point,title:m.title,label:String(m.n),...(time?{time}:{}),activityID:m.activityID,selected:m.activityID===selected};
 });
}
// Observed distance only: never connect GPS gaps, redacted stretches or activities.
// A day can contain only part of a drive, so this is labelled "recorded", not a total.
export function recordedDistance(activity){
 let total=0;
 for(const line of activity.routes)for(let i=1;i<line.length;i++)total+=distanceMetres({latitude:line[i-1][0],longitude:line[i-1][1]},{latitude:line[i][0],longitude:line[i][1]});
 return total;
}
