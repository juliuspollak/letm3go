import {metres} from './journeyGeometry.js';
import {normaliseTag,tagKey} from './tagSearch.js';
import {placeSaved,REMEMBER_RADIUS} from './tagMessaging.js';

// savePlace only accepts its own UUID ids, so a place from another device is left
// alone rather than rewritten under an id the recorder does not own.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const radiusOf=place=>Math.max(50,Math.min(2000,Number(place?.radius)||REMEMBER_RADIUS));
const listOf=places=>Array.isArray(places)?places:Object.values(places||{});

// The saved place that already covers a point, nearest first. This is the same
// question the tags section asks, so the answer never disagrees with recognition.
export function rememberedPlaceAt(places,point){
 if(!Number.isFinite(point?.latitude)||!Number.isFinite(point?.longitude))return null;
 return listOf(places)
  .filter(place=>Number.isFinite(place?.latitude)&&Number.isFinite(place?.longitude)&&String(place?.name||'').trim())
  .map(place=>({id:place.id?String(place.id):null,name:String(place.name).trim(),radius:radiusOf(place),metres:metres(place,point)}))
  .filter(place=>place.metres<=place.radius)
  .sort((a,b)=>a.metres-b.metres||a.name.localeCompare(b.name))[0]||null;
}

// Remembering a destination is the only way a place becomes recognised on future
// visits: one saved place at the activity's end point, which the recognition rules
// then match against. A place of the same name already covering that spot is
// reused, so one destination keeps one record. Nothing here edits the activity, so
// it works whether or not the tag is already on it — the silent no-op is gone.
export async function rememberDestinationPlace({trip,run,grouping,name}){
 const end=(trip?.segments?.at(-1)||trip)?.points?.at(-1);
 if(!Number.isFinite(end?.latitude)||!Number.isFinite(end?.longitude))throw new Error('This activity has no end point to remember.');
 if(typeof run!=='function')throw new Error('Saving a place needs the recorder on this device.');
 const label=normaliseTag(name);
 if(!label)throw new Error('Enter a name to remember this destination.');
 const existing=Object.values(grouping?.metadata?.places||{}).find(place=>place?.id&&UUID.test(String(place.id))
  &&place.kind!=='home'&&place.kind!=='work'&&tagKey(place.name)===tagKey(label)
  &&Number.isFinite(place.latitude)&&Number.isFinite(place.longitude)
  &&metres(place,end)<=radiusOf(place));
 const saved=await run('savePlace',{...(existing?{id:String(existing.id)}:{}),name:label,kind:'favourite',latitude:end.latitude,longitude:end.longitude,radius:REMEMBER_RADIUS});
 if(!saved)throw new Error('Could not save the destination.');
 return {id:existing?String(existing.id):null,name:label,radius:REMEMBER_RADIUS,notice:placeSaved(label)};
}
