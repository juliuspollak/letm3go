import {useEffect,useMemo,useState} from 'react';
import {supabase} from './supabase.js';
import {cachedScope,trimJourneyCache} from './journeyCache.js';
import {ensureJourneyScope} from './journeyMetadataStore.js';
// Requests only the currently displayed relationship context. Selection/map
// requests opt in to heavy records; ordinary list context never does.
export function useJourneyScope({owner,sync,refs,details=[],localDetailIDs=[]}){
 const key=JSON.stringify([refs,details,localDetailIDs]),[state,setState]=useState({key:null,loading:false,error:''});
 const input=useMemo(()=>JSON.parse(key),[key]);
 const cursor=sync.read().status?.cursorRevision;
 useEffect(()=>{
  let alive=true;
  const run=async()=>{
   try{
    await sync.ready();
    sync.configureScope(input[0],input[1]);
    if(!input[0].length){if(alive)setState({key,loading:false,error:''});return;}
    const available=scope=>scope&&input[0].every(id=>scope.ids.includes(id))&&input[1].every(id=>scope.details.includes(id)&&(input[2].includes(id)||Array.isArray(sync.read().activityRows?.[id]?.route_points)));
    if(!navigator.onLine){
     const saved=Object.values(sync.read().cache.scopes).find(available);
     if(!saved)throw new Error('Saved journey grouping or route details are not cached. Reconnect to load them.');
     if(saved.unavailable?.some(id=>!input[2].includes(id)))throw new Error('Some source recordings are unavailable. This journey grouping cannot be shown as complete.');
     await sync.write(latest=>({cache:{...latest.cache,active:input[0]}}));
     if(alive)setState({key,loading:false,error:''});return;
    }
    const cached=available(cachedScope(sync.read(),input[0],input[1]));
    if(alive)setState({key,loading:!cached,error:''});
    await sync.write(latest=>({cache:{...latest.cache,active:input[0]}}));
    await ensureJourneyScope({client:supabase,owner,read:sync.read,write:sync.write},input[0],input[1],{force:!cached});
    await sync.write(latest=>trimJourneyCache(latest));
    const known=cachedScope(sync.read(),input[0],input[1]);
    if(known?.unavailable?.some(id=>!input[2].includes(id)))throw new Error('Some source recordings are unavailable. This journey grouping cannot be shown as complete.');
    if(alive)setState({key,loading:false,error:''});
   }catch(error){if(alive)setState({key,loading:false,error:error.message||'Saved journey context is unavailable.'});}
  };
  void run();return()=>{alive=false;};
 },[sync,owner,key,input,cursor]);
 return state.key===key?state:{loading:true,error:''};
}
