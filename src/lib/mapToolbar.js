import {activityCode,activityLabel,activityOptions,sameActivity} from './activityNames.js';
import {activeMapFilters,chooseMapDay,chooseRouteLayer,dayLabel,localDay,mapLayersChanged,RANGE_OPTIONS,resetMapFilters,shiftMapDay,supportsRange} from './mapLayers.js';

export function activitySymbol(activity){
 const name=activity.toLowerCase();
 if(/driv|car/.test(name))return 'car';
 if(activityCode(activity)==='MTB')return 'mountain.2';
 if(/cycl|bik/.test(name))return 'bicycle';
 if(/run/.test(name))return 'figure.run';
 if(/hik/.test(name))return 'figure.hiking';
 if(/kite|surf/.test(name))return 'figure.surfing';
 if(/walk/.test(name))return 'figure.walk';
 return 'figure.mixed.cardio';
}
// Serializable controls are rendered by UIKit and React. Actions always return
// to React; neither renderer owns a second copy of the saved filter state.
//
// On the map a control is never filled with the accent: only the count badge and
// the Following location button use it. Inside a panel the accent means "applied
// now". The tab bar keeps its own accent for the current page.
const option=(id,label,symbol,selected=false,extra={})=>({id,label,symbol,text:label,selected,...extra});
function filterSections(view,activities,today,archivedCount){
 const ranged=supportsRange(view);
 const sections=[
  {id:'show',label:'On the map',options:[option('people','People & places','person.2',view.people)]},
  {id:'routes',label:'Routes',options:[option('route:off','Off','nosign',!view.routes),option('route:today','Today','sun.max',view.routes==='today'),option('route:pinned','Favourites','star',view.routes==='pinned'),option('route:all','All routes','point.topleft.down.to.point.bottomright.curvepath',view.routes==='all')]},
  {id:'date',label:'Date',options:[...RANGE_OPTIONS.map(([id,label])=>option('range:'+id,label,null,ranged&&!view.day&&view.range===id)),option('day:'+(view.day||today),'One day',null,ranged&&Boolean(view.day))]},
 ];
 if(view.routes){
  sections.push({id:'activity',label:'Activity',options:[option('activity:','All activities','figure.mixed.cardio',!view.activity),...activityOptions(activities).map(a=>option('activity:'+a,activityLabel(a),activitySymbol(a),sameActivity(view.activity,a)))]});
  if(archivedCount>0)sections.push({id:'archived',label:'Archive',options:[option('archived',`Archived activities (${archivedCount})`,'archivebox',view.archived)]});
 }
 return sections;
}
const layerSections=view=>[
 {id:'style',label:'Map style',options:[option('style:standard','Standard','map',view.style==='standard'),option('style:satellite','Satellite','globe.americas',view.style==='satellite')]},
 {id:'mode',label:'Show',options:[option('mode:routes','My map','person.2',view.content==='routes'),option('mode:trails','Community trails','mountain.2',view.content==='trails')]},
];
// Shown only while routes are limited to one day, so stepping through days never
// needs the panel. The Today layer is one day too, and stepping leaves it.
function dateBar(view,today){
 if(view.content!=='routes'||!view.routes)return null;
 const day=view.routes==='today'?today:supportsRange(view)?view.day:null;
 if(!day)return null;
 return {
  label:day===today?'Today':dayLabel(day),
  accessibilityLabel:`Showing routes for ${new Date(day+'T12:00:00').toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long',year:'numeric'})}`,
  previous:{id:'day:'+shiftMapDay(day,-1),label:'Previous day',symbol:'chevron.left'},
  next:{id:'day:'+shiftMapDay(day,1),label:'Next day',symbol:'chevron.right',disabled:day>=today},
  today:day<today?{id:'day:'+today,label:'Return to Today',text:'Today'}:null,
  clear:view.day?{id:'day:clear',label:'Show all dates',symbol:'xmark'}:null,
 };
}
export function mapControls(view,panel,activities=[],today=localDay(),archivedCount=0){
 const active=activeMapFilters(view,archivedCount);
 const summary=active.join(', ');
 const open=view.content==='routes'||panel==='layers'?panel:null;
 return {
  active:active.length,
  style:view.style,
  // Community trails is its own map, with nothing here to filter.
  filters:view.content==='routes'?{id:'panel:filters',text:active.length?`Filters · ${summary}`:'Filters',label:active.length?`Filters, ${active.length} active: ${summary}`:'Filters',symbol:'line.3.horizontal.decrease',count:active.length,expanded:open==='filters'}:null,
  layers:{id:'panel:layers',text:'Layers',label:mapLayersChanged(view)?`Map layers: ${view.content==='trails'?'Community trails':'Satellite'}`:'Map layers',symbol:'square.3.layers.3d',changed:mapLayersChanged(view),expanded:open==='layers'},
  date:open?null:dateBar(view,today),
  panel:open==='filters'?{id:'filters',title:'Filters',reset:active.length?{id:'reset',label:'Reset filters',text:'Reset'}:null,sections:filterSections(view,activities,today,archivedCount)}
   :open==='layers'?{id:'layers',title:'Map layers',reset:null,sections:layerSections(view)}:null,
 };
}
export function panelChange(panel,id){
 if(id==='panel:close')return null;
 const next=id.slice('panel:'.length);
 return panel===next?null:next;
}
export function toolbarChange(view,id){
 const [kind,...rest]=id.split(':');const value=rest.join(':');
 if(kind==='mode')return {...view,content:value};
 if(kind==='people')return {...view,people:!view.people};
 if(kind==='route')return value==='off'?{...view,routes:null}:chooseRouteLayer(view,value);
 if(kind==='day')return value==='clear'?{...view,day:null}:chooseMapDay(view,value);
 if(kind==='range')return {...view,day:null,range:value,routes:view.routes==='pinned'?'pinned':'all'};
 if(kind==='activity')return {...view,activity:value};
 if(kind==='style')return {...view,style:value};
 if(kind==='archived')return {...view,archived:!view.archived};
 if(kind==='reset')return resetMapFilters(view);
 return view;
}
