import {useEffect,useMemo,useState} from 'react';
import {fetchSegments} from './mtbApi.js';
import {routeBounds} from './mtbLink.js';
const EMPTY=[];
// Public definitions are discovered by area on any device. GPS remains in the
// existing owner-private cache; efforts/rankings are computed by the same matcher.
export function usePublicSegments(trip){
 const [state,setState]=useState({key:'',segments:EMPTY,error:''});
 const bounds=useMemo(()=>trip?.activity==='MTB'&&trip.points?.length>1?routeBounds(trip.points):null,[trip]);
 const key=bounds?JSON.stringify(bounds):'';
 useEffect(()=>{
  if(!key)return;let alive=true;
  void fetchSegments(JSON.parse(key)).then(rows=>{if(alive)setState({key,segments:rows.filter(row=>row.status==='approved'&&row.visibility==='public'),error:''});})
   .catch(()=>{if(alive)setState({key,segments:EMPTY,error:'Public segments are unavailable offline. Your private recording is unchanged.'});});
  return()=>{alive=false;};
 },[key]);
 return state.key===key?state:{segments:EMPTY,error:''};
}
