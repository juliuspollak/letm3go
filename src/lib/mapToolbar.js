import {chooseMapDay,chooseRouteLayer,localDay,RANGE_OPTIONS,shiftMapDay} from './mapLayers.js';

export function activitySymbol(activity){
 const name=activity.toLowerCase();
 if(/driv|car/.test(name))return 'car';
 if(/mtb/.test(name))return 'mountain.2';
 if(/cycl|bik/.test(name))return 'bicycle';
 if(/run/.test(name))return 'figure.run';
 if(/hik/.test(name))return 'figure.hiking';
 if(/kite|surf/.test(name))return 'figure.surfing';
 if(/walk/.test(name))return 'figure.walk';
 return 'figure.mixed.cardio';
}
// Serializable controls are rendered by UIKit and React. Actions always return
// to React; neither renderer owns a second copy of the saved filter state.
export function mapToolbar(view,open,category,activities=[],today=localDay()){
 const option=(id,label,symbol,selected=false,text=null)=>({id,label,symbol,selected,text});
 const rows=[{id:'mode',label:'Map type',symbol:'map',options:[option('mode:routes','My routes','map',view.content==='routes'),option('mode:trails','Community trails','mountain.2',view.content==='trails')]}];
 if(view.content==='routes'){
  rows.push({id:'people',label:'People & places',symbol:'person.2',selected:view.people});
  rows.push({id:'routes',label:'Routes',symbol:'point.topleft.down.to.point.bottomright.curvepath',selected:!!view.routes,options:[option('route:today','Today','sun.max',view.routes==='today'),option('route:pinned','Favourites','star',view.routes==='pinned'),option('route:all','All routes','point.topleft.down.to.point.bottomright.curvepath',view.routes==='all'),option('route:off','Routes off','nosign',!view.routes)]});
  const day=view.day||today;
  rows.push({id:'calendar',label:'Calendar',symbol:'calendar',selected:!!view.day||view.range!=='any',options:[option('day:'+shiftMapDay(day,-1),'Previous day','chevron.left'),option('day:'+today,day===today?'Today':'Return to Today','calendar',!!view.day,day===today?'Today':new Date(day+'T12:00:00').toLocaleDateString(undefined,{day:'numeric',month:'short'})),{...option('day:'+shiftMapDay(day,1),'Next day','chevron.right'),disabled:day>=today},...RANGE_OPTIONS.map(([id,label])=>option('range:'+id,label,'clock',!view.day&&view.range===id,id==='any'?'All':id.replace('d','d')))]});
  if(view.routes)rows.push({id:'activity',label:'Activity',symbol:'figure.mixed.cardio',selected:!!view.activity,options:[option('activity:','All activities','figure.mixed.cardio',!view.activity),...activities.map(a=>option('activity:'+a,a,activitySymbol(a),view.activity===a))]});
 }
 return {open,category,rows};
}
export function toolbarChange(view,id){
 const [kind,...rest]=id.split(':');const value=rest.join(':');
 if(kind==='mode')return {...view,content:value};
 if(kind==='people')return {...view,people:!view.people};
 if(kind==='route')return value==='off'?{...view,routes:null}:chooseRouteLayer(view,value);
 if(kind==='day')return chooseMapDay(view,value);
 if(kind==='range')return {...view,day:null,range:value,routes:view.routes==='pinned'?'pinned':'all'};
 if(kind==='activity')return {...view,activity:value};
 return view;
}
