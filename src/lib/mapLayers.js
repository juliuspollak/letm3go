// What the Map tab shows, in one value:
// - content: 'routes' (your own map) or 'trails' (Community trails). Mutually
//   exclusive: they are different maps with different tools.
// - people:  People & places, independent of everything else.
// - routes:  null, 'today', 'pinned' (favourites) or 'all'. One at a time.
// - activity / range: advanced filters for the routes; Today has its own range.
export const DEFAULT_MAP_VIEW=Object.freeze({content:'routes',people:true,routes:null,activity:'',range:'any',day:null});
export const ROUTE_LAYERS=[['today','Today'],['pinned','Favourites'],['all','All routes']];
export const RANGE_OPTIONS=[['any','Any time'],['7d','Past 7 days'],['30d','Past 30 days'],['365d','Past year']];
const RANGE_DAYS={'7d':7,'30d':30,'365d':365};

export function normaliseMapView(value){
 const view={...DEFAULT_MAP_VIEW,...(value&&typeof value==='object'?value:{})};
 return {
  content:view.content==='trails'?'trails':'routes',
  people:view.people!==false,
  routes:ROUTE_LAYERS.some(([id])=>id===view.routes)?view.routes:null,
  activity:typeof view.activity==='string'?view.activity.slice(0,60):'',
  range:RANGE_DAYS[view.range]?view.range:'any',
  day:validDay(view.day)?view.day:null
 };
}

// One route layer at a time; choosing the selected one again turns routes off.
export function chooseRouteLayer(view,id){
 return {...view,routes:view.routes===id?null:ROUTE_LAYERS.some(([key])=>key===id)?id:view.routes};
}
export const clearMapFilters=view=>({...view,activity:'',range:'any',day:null});

// Advanced filters only apply to a route layer that supports them.
export const supportsActivity=view=>view.content==='routes'&&Boolean(view.routes);
export const supportsRange=view=>view.content==='routes'&&(view.routes==='all'||view.routes==='pinned');

// Anything other than the default view, for the unobtrusive indicator.
export function activeLayerCount(view){
 return (view.content!=='routes'?1:0)+(view.content==='routes'&&!view.people?1:0)+(view.content==='routes'&&view.routes?1:0)
  +(supportsActivity(view)&&view.activity?1:0)+(supportsRange(view)&&(view.range!=='any'||view.day)?1:0);
}

export function mapViewJourneys(journeys,view,today,saved=[],nowMs=Date.now()){
 if(view.content!=='routes'||!view.routes)return [];
 const sinceSeconds=supportsRange(view)&&RANGE_DAYS[view.range]?nowMs/1000-RANGE_DAYS[view.range]*86400:null;
 return journeys.filter(trip=>{
  if(view.routes==='today'&&!(trip.date===today||trip.segments?.some(segment=>segment.date===today)))return false;
  if(view.routes==='pinned'&&!(saved.includes(trip.id)||trip.segmentIDs?.some(id=>saved.includes(id))))return false;
  if(supportsRange(view)&&view.day&&!journeyOnDay(trip,view.day))return false;
  if(!view.day&&sinceSeconds!=null&&!((trip.endedAt||trip.startedAt||0)>=sinceSeconds))return false;
  if(supportsActivity(view)&&view.activity&&trip.activity!==view.activity)return false;
  return true;
 });
}

// Activity types that actually occur, so the filter never offers an empty choice.
export function activityChoices(journeys){
 return [...new Set(journeys.map(trip=>trip.activity).filter(value=>typeof value==='string'&&value.trim()))].sort((a,b)=>a.localeCompare(b));
}

// Kept per account on this device, so the map comes back as it was left.
const storageKey=owner=>`letm3go:map-view:${owner}`;
export function loadMapView(owner){
 try{return normaliseMapView(JSON.parse(localStorage.getItem(storageKey(owner))||'null'));}catch{return {...DEFAULT_MAP_VIEW};}
}
export function saveMapView(owner,view){
 try{localStorage.setItem(storageKey(owner),JSON.stringify(normaliseMapView(view)));}catch{/* private mode */}
}

export function localDay(date=new Date()){
 return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function validDay(day){
 return typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day)&&localDay(new Date(day+'T12:00:00'))===day;
}
export function shiftMapDay(day,amount){const date=new Date(day+'T12:00:00');date.setDate(date.getDate()+amount);return localDay(date);}
// Test each observed segment separately: a gap between grouped recordings is
// not evidence of activity on every intervening day. End boundaries are exclusive.
export function journeyOnDay(trip,day){
 const start=new Date(day+'T00:00:00').getTime()/1000;
 const end=new Date(shiftMapDay(day,1)+'T00:00:00').getTime()/1000;
 const matches=part=>Number.isFinite(part.startedAt)&&Number.isFinite(part.endedAt)
  ? part.startedAt<end&&(part.endedAt>start||(part.endedAt===part.startedAt&&part.startedAt===start))
  : part.date===day;
 return trip.segments?.length?trip.segments.some(matches):matches(trip);
}
// Choosing a day enables All routes from Off/Today; Favourites stays scoped.
// The saved rolling range remains intact, and resumes when day is cleared.
export const chooseMapDay=(view,day)=>({...view,day,routes:view.routes==='pinned'?'pinned':'all'});
