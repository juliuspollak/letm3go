import {useEffect,useRef,useState} from 'react';
import {recorder,recorderAvailable} from './recorder.js';

const RETRY_MS=60_000;
const MOVING=['Driving','Walking','Running','Cycling','MTB','Road cycling','Kitesurfing'];

export function usePeoplePlaceLabels(people,{enabled,scope}){
 const [labels,setLabels]=useState({});
 const cache=useRef(new Map());
 const queue=useRef(Promise.resolve());
 const available=enabled&&recorderAvailable();
 const targets=available?people.flatMap(({userId,position,location,locationAt})=>{
  if(!userId||location?.state!=='live'||location.home||location.verifiedHome||location.savedPlace||location.placeName||
     !Number.isFinite(position?.latitude)||!Number.isFinite(position?.longitude))return [];
  const moving=MOVING.includes(location.activity)||(Number.isFinite(location.speedKmh)&&location.speedKmh>=8);
  const {latitude,longitude,accuracy}=position;
  const coarse=Number.isFinite(accuracy)&&accuracy>100;
  const precision=coarse?2:moving?3:4;
  const key=JSON.stringify([scope,userId,moving,coarse,latitude.toFixed(precision),longitude.toFixed(precision)]);
  return [{userId,key,latitude,longitude,moving,coarse,locationAt}];
 }):[];
 // The fix may update inside the same area without changing the label. Key work
 // to the area and retry failed lookups on a later shared fix.
 const targetKey=JSON.stringify(targets.map(({key})=>key));
 const fixKey=JSON.stringify(targets.map(({locationAt})=>locationAt));
 useEffect(()=>{
  if(!available||!targets.length)return;
  let active=true;
  for(const {userId,key,latitude,longitude,moving,coarse} of targets){
   queue.current=queue.current.then(async()=>{
    if(!active)return;
    let entry=cache.current.get(key);
    if(!entry||(!entry.label&&Date.now()-entry.at>=RETRY_MS)){
     let label='';
     try{label=(await recorder.nearbyPeoplePlace({latitude,longitude,moving,coarse}))?.label||'';}catch{/* A failed lookup leaves the tile as-is. */}
     entry={label,at:Date.now()};
     cache.current.set(key,entry);
     if(cache.current.size>128)cache.current.delete(cache.current.keys().next().value);
    }
    if(active)setLabels(previous=>previous[userId]?.key===key&&previous[userId]?.label===entry.label?previous:{...previous,[userId]:{key,label:entry.label}});
   });
  }
  return()=>{active=false;};
  // Coordinates are sampled from the fix that first enters this label area.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[available,targetKey,fixKey]);
 return Object.fromEntries(targets.flatMap(({userId,key})=>labels[userId]?.key===key&&labels[userId].label?[[userId,labels[userId].label]]:[]));
}
