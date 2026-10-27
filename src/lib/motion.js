import {useEffect,useState} from 'react';

function reducedMotionQuery(){
 return typeof window!=='undefined'&&typeof window.matchMedia==='function'?window.matchMedia('(prefers-reduced-motion: reduce)'):null;
}

// One accessibility source for every animated component. Motion is decorative,
// so a reduced-motion preference always resolves to the static presentation.
export function useReducedMotion(){
 const [reduced,setReduced]=useState(()=>Boolean(reducedMotionQuery()?.matches));
 useEffect(()=>{
  const media=reducedMotionQuery();
  if(!media)return;
  const update=()=>setReduced(Boolean(media.matches));
  update();
  media.addEventListener?.('change',update);
  return()=>media.removeEventListener?.('change',update);
 },[]);
 return reduced;
}

