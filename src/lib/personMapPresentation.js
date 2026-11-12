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
export function personRoutes(day,selected){
 const activities=selected?[...day.activities].sort((a,b)=>Number(b.id===selected)-Number(a.id===selected)):day.activities;
 return activities.flatMap(a=>[...a.routes.map(line=>({line,color:'accent'})),...a.roads.map(r=>({line:r.line,color:'#F29927'}))].map(({line,color})=>({points:thinLine(line),activityID:a.id,color,width:selected===a.id?4:2.5,opacity:selected&&selected!==a.id?0.18:0.65}))).slice(0,500).sort((a,b)=>Number(a.activityID===selected)-Number(b.activityID===selected));
}
// Observed distance only: never connect GPS gaps, redacted stretches or activities.
// A day can contain only part of a drive, so this is labelled "recorded", not a total.
export function recordedDistance(activity){
 let total=0;
 for(const line of activity.routes)for(let i=1;i<line.length;i++)total+=distanceMetres({latitude:line[i-1][0],longitude:line[i-1][1]},{latitude:line[i][0],longitude:line[i][1]});
 return total;
}
