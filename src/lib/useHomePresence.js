import {useMemo,useState} from 'react';
import {atHome} from './householdLocation.js';

// Who is at Home, with boundary hysteresis remembered between renders so the
// Home tag does not flicker. Only `eligible` people (a live position, never a
// stale one) can be at Home.
//
// The memory is a stable Map and the flags are recomputed only when the inputs
// change by value. No state update happens during render (that restarts the
// whole App render). Recomputing twice for the same inputs is harmless: applying
// the same position again yields the same answer.
export function useHomePresence(people,home){
 const [memory]=useState(()=>new Map());
 const signature=JSON.stringify([home?.latitude??null,home?.longitude??null,home?.radius??null,
  people.map(p=>[p.id,Boolean(p.eligible),p.point?.latitude??null,p.point?.longitude??null,p.point?.accuracy??null])]);
 return useMemo(()=>{
  const [latitude,longitude,radius,entries]=JSON.parse(signature);
  const place=latitude==null||longitude==null?null:{latitude,longitude,radius};
  const flags={};
  for(const [id,eligible,pointLatitude,pointLongitude,accuracy] of entries){
   const point=pointLatitude==null||pointLongitude==null?null:{latitude:pointLatitude,longitude:pointLongitude,accuracy};
   const next=eligible&&atHome(memory.get(id)===true,point,place);
   memory.set(id,next);flags[id]=next;
  }
  return flags;
 },[signature,memory]);
}
