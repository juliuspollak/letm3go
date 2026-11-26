import {useEffect} from 'react';
import {recorder,recorderAvailable} from './recorder.js';

export function useSocialRestPlaces(owner,places,ready){
 useEffect(()=>{
  if(!owner||!ready||!recorderAvailable())return;
  const coordinates=places.map(({id,latitude,longitude,radius})=>({id,latitude,longitude,radius}));
  let active=true,timer,delay=1000;
  async function sync(){
   try{
    await recorder.setSocialRestPlaces(owner,coordinates);
   }catch{
    if(!active)return;
    timer=setTimeout(sync,delay);
    delay=Math.min(delay*2,30000);
   }
  }
  void sync();
  return()=>{active=false;clearTimeout(timer);};
 },[owner,places,ready]);
}
