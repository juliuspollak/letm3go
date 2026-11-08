import {metres} from './journeyGeometry.js';
import {normaliseTag,tagKey} from './tagSearch.js';
import {placeSaved,REMEMBER_RADIUS} from './tagMessaging.js';

// savePlace only accepts its own UUID ids, so a place from another device is left
// alone rather than rewritten under an id the recorder does not own.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const listOf=places=>Array.isArray(places)?places:Object.values(places||{});

// One rule for how big a saved place is, wherever it is read: the tags section,
// this module and recognition all measure the same fence, so the section can never
// promise a place that recognition does not see (or the other way round).
export const savedPlaceRadius=place=>Math.max(50,Math.min(2000,Number(place?.radius)||REMEMBER_RADIUS));

// Home and Work are where a person lives and works, not a destination they chose
// to name. Recognition never titles a trip with them and destination messages are
// derived from the same two kinds, so the tags section never says "Saved place:
// ... Home" for a trip recognition will never name. Everything else about Home and
// Work (arrival detection, quiet rest, home screens) is untouched: this list is
// only consulted by remembered destinations.
export const PERSONAL_PLACE_KINDS=['home','work'];
export const personalPlace=place=>PERSONAL_PLACE_KINDS.includes(String(place?.kind||'').toLocaleLowerCase());

// The saved place that already covers a point, nearest first. This is the same
// question the tags section asks, so the answer never disagrees with recognition.
// `includePersonal` is for callers that really do want Home/Work; the destination
// question does not, because recognition will not use them either.
export function rememberedPlaceAt(places,point,{includePersonal=false}={}){
 if(!Number.isFinite(point?.latitude)||!Number.isFinite(point?.longitude))return null;
 return listOf(places)
  .filter(place=>Number.isFinite(place?.latitude)&&Number.isFinite(place?.longitude)&&String(place?.name||'').trim())
  .filter(place=>includePersonal||!personalPlace(place))
  .map(place=>({id:place.id?String(place.id):null,name:String(place.name).trim(),kind:String(place.kind||''),radius:savedPlaceRadius(place),metres:metres(place,point)}))
  .filter(place=>place.metres<=place.radius)
  .sort((a,b)=>a.metres-b.metres||a.name.localeCompare(b.name))[0]||null;
}

// Remembering a destination is the only way a place becomes recognised on future
// visits: one saved place at the activity's end point, which the recognition rules
// then match against. A place of the same name already covering that spot is
// reused, so one destination keeps one record. Nothing here edits the activity, so
// it works whether or not the tag is already on it — the silent no-op is gone.
// `places` are the person's saved places (the recorder's list, not the journey
// metadata's lookup cache). `lastError` is the recorder's reason for a failed call,
// so a failure names its cause instead of guessing one.
export async function rememberDestinationPlace({trip,run,places,name,lastError}){
 const end=(trip?.segments?.at(-1)||trip)?.points?.at(-1);
 if(!Number.isFinite(end?.latitude)||!Number.isFinite(end?.longitude))throw new Error('This activity has no end point to remember.');
 if(typeof run!=='function')throw new Error('Saving a place needs the recorder on this device.');
 const label=normaliseTag(name);
 if(!label)throw new Error('Enter a name to remember this destination.');
 const existing=listOf(places).find(place=>place?.id&&UUID.test(String(place.id))
  &&!personalPlace(place)&&tagKey(place.name)===tagKey(label)
  &&Number.isFinite(place.latitude)&&Number.isFinite(place.longitude)
  &&metres(place,end)<=savedPlaceRadius(place));
 const saved=await run('savePlace',{...(existing?{id:String(existing.id)}:{}),name:label,kind:'favourite',latitude:end.latitude,longitude:end.longitude,radius:REMEMBER_RADIUS});
 if(!saved)throw new Error(lastError?.()||'Could not save the destination.');
 return {id:existing?String(existing.id):null,name:label,radius:REMEMBER_RADIUS,notice:placeSaved(label)};
}
