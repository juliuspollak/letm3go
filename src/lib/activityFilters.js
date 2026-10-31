import {activityLabel,sameActivity} from './activityNames.js';
import {journeyOnDay,RANGE_DAYS,RANGE_OPTIONS,shiftMapDay,validDay} from './mapLayers.js';

// One date selection: 'all', 'today', a calendar day, or a rolling range ('7d').
// The arrows, the date picker and the filter panel all write this same value, so
// the latest choice replaces the last and no two date filters can disagree.
export const chosenDay=(date,today)=>date==='today'?today:validDay(date)?date:null;

export function shiftDate(date,amount,today){
 const day=shiftMapDay(chosenDay(date,today)||today,amount);
 return day>=today?'today':day;
}
export const canShiftForward=(date,today)=>{const day=chosenDay(date,today);return Boolean(day)&&day<today;};

export function matchesDate(trip,date,today,nowMs=Date.now()){
 if(date==='all')return true;
 if(RANGE_DAYS[date])return (trip.endedAt||trip.startedAt||0)>=nowMs/1000-RANGE_DAYS[date]*86400;
 const day=chosenDay(date,today);
 return day?journeyOnDay(trip,day):true;
}

// For a mouse, keyboard or screen reader. A date input opens from its own calendar icon
// on desktop, so showPicker is needed there, but on iOS it returns without opening
// anything and without an error: focus has to run as well, never only as a fallback.
// A finger on a touch screen reaches the real input directly (see styles.css).
export function openDatePicker(input){
 input.focus();
 try{input.showPicker();}catch{/* Refused or unavailable: focus has already run. */}
}

export function dateLabel(date,today){
 if(date==='all')return 'All dates';
 const range=RANGE_OPTIONS.find(([id])=>id===date);
 if(range)return range[1];
 const day=chosenDay(date,today);
 if(!day)return 'All dates';
 if(day===today)return 'Today';
 if(day===shiftMapDay(today,-1))return 'Yesterday';
 return new Date(day+'T12:00:00').toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'});
}

// Sort is a preference, not a filter: it never hides an activity.
export const activeFilterCount=({activity,date,favourites,archived,equipment})=>
 [activity!=='All activities',date!=='all',favourites,archived,Boolean(equipment)].filter(Boolean).length;

const SORTS=[['newest','Newest'],['distance','Distance'],['duration','Duration']];
// Rendered by FilterToolbar, in the same shape as lib/mapToolbar.js.
export function activityToolbar({open,category,activities,activity,date,favourites,archived,archivedCount,sort,equipment,equipmentOptions,today}){
 const option=(id,label,selected)=>({id,label,text:label,selected});
 const yesterday=shiftMapDay(today,-1);
 const rows=[
  {id:'date',label:'Date',text:'Date',selected:date!=='all',options:[
   option('date:all','All dates',date==='all'),option('date:today','Today',chosenDay(date,today)===today),option('date:'+yesterday,'Yesterday',chosenDay(date,today)===yesterday),
   ...RANGE_OPTIONS.filter(([id])=>RANGE_DAYS[id]).map(([id,label])=>option('date:'+id,label,date===id))]},
  {id:'activity',label:'Activity type',text:'Type',selected:activity!=='All activities',options:activities.map(name=>option('activity:'+name,activityLabel(name),sameActivity(activity,name)))},
  {id:'favourites',label:'Favourites',text:'Favourites',selected:favourites},
 ];
 if(archivedCount>0||archived)rows.push({id:'archived',label:`Archived activities (${archivedCount})`,text:`Archived (${archivedCount})`,selected:archived});
 rows.push({id:'sort',label:'Sort by',text:'Sort',selected:sort!=='newest',options:SORTS.map(([id,label])=>option('sort:'+id,label,sort===id))});
 if(equipmentOptions.length)rows.push({id:'equipment',label:'Equipment',text:'Equipment',selected:Boolean(equipment),options:[
  option('equipment:','Any equipment',!equipment),...equipmentOptions.map(({id,name,count})=>option('equipment:'+id,`${name} (${count})`,equipment===id))]});
 if(activeFilterCount({activity,date,favourites,archived,equipment}))rows.push({id:'reset',label:'Reset filters',text:'Reset'});
 return {open,category,rows};
}
