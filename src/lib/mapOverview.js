// What the Map overview sends to the native map once per change of journeys or
// filters (never with every location update): the route density, one pin per
// journey photo with what its preview card shows, and the simplified route of
// each journey that has photos, so selecting a photo can highlight exactly that
// journey without another round trip.
import {displaySegments} from './mapGeometry.js';
import {densityKey,routeDensity,validRuns} from './routeDensity.js';
import {distanceText} from './distanceUnits.js';

export const OVERVIEW_PHOTO_LIMIT=3000;
export const HIGHLIGHT_POINTS=600;
const valid=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180;

export function journeyDateText(journey){
 const at=Number.isFinite(journey?.startedAt)&&journey.startedAt>0?new Date(journey.startedAt*1000):journey?.date?new Date(`${journey.date}T12:00:00`):null;
 return at&&!Number.isNaN(at.getTime())?at.toLocaleDateString('en-AU',{weekday:'short',day:'numeric',month:'short',year:'numeric'}):'';
}

export function overviewPhotos(journeys,unit='km'){
 const photos=[];
 for(const journey of [...journeys].sort((a,b)=>(b.startedAt||0)-(a.startedAt||0))){
  for(const photo of journey.photos||[]){
   if(photos.length>=OVERVIEW_PHOTO_LIMIT)return photos;
   if(!valid(photo?.point)||photo.id==null)continue;
   const km=Number(journey.distance)||(Number(journey.distanceMeters)||0)/1000;
   photos.push({
    id:`photo:${photo.id}`,kind:'photo',point:photo.point,photoID:String(photo.id),journeyID:String(journey.id),
    title:photo.caption||'Journey photo',
    // Only what is known; the card leaves out anything empty.
    journeyTitle:journey.title||journey.activity||'',
    journeyDate:journeyDateText(journey),
    ...(km>0?{journeyDistance:distanceText(km,unit)}:{})
   });
  }
 }
 return photos;
}

// The exact (display-simplified) route of each journey with a photo, split at
// invalid samples. A journey without at least two valid points in a row is left
// out: its photo still opens a preview, but no route is invented for it.
export function highlightRoutes(journeys,photos){
 const wanted=new Set(photos.map(p=>p.journeyID));
 const routes={};
 for(const journey of journeys){
  const id=String(journey.id);
  if(!wanted.has(id))continue;
  // About a metre of precision is plenty for a highlighted line and halves the
  // data sent to the native map.
  const segments=validRuns(displaySegments(journey,HIGHLIGHT_POINTS)).map(run=>run.map(p=>[Math.round(p[0]*1e5)/1e5,Math.round(p[1]*1e5)/1e5]));
  if(segments.length)routes[id]=segments;
 }
 return routes;
}

// The key covers every journey's route content (routeSignature), titles,
// distances and photos, so any edit produces new data for the native map.
export function overviewKey(journeys,unit='km'){
 const extra=`${unit}|${journeys.map(j=>`${j.id}:${j.title||''}:${j.activity||''}:${j.distance||j.distanceMeters||''}:${(j.photos||[]).map(p=>`${p.id}/${p.caption||''}/${p.point}`).join(';')}`).sort().join(',')}`;
 return densityKey(journeys,extra);
}

// The last few overviews, by key: switching filters back and forth reuses them.
const results=new Map();
export function mapOverview(journeys,{unit='km'}={}){
 const key=overviewKey(journeys,unit);
 const cached=results.get(key);
 if(cached)return cached;
 const started=typeof performance!=='undefined'?performance.now():Date.now();
 const photos=overviewPhotos(journeys,unit);
 const density=routeDensity(journeys);
 const overview={key,...density,photos,routes:highlightRoutes(journeys,photos)};
 overview.stats={ms:Math.round((typeof performance!=='undefined'?performance.now():Date.now())-started),points:density.points,
  lines:density.levels.reduce((n,l)=>n+l.buckets.reduce((k,b)=>k+b.lines.length,0),0)};
 results.set(key,overview);
 while(results.size>4)results.delete(results.keys().next().value);
 return overview;
}
