import {useCallback,useState} from 'react';
import Places from './Places.jsx';
import {supabase} from '../lib/supabase.js';

export default function HouseholdPlaces({selfId,places,memberPoints,mapCenter,peoplePins,refresh,error:loadError,recorderRun}){
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const run=useCallback(async(method,value)=>{
  if(method==='searchAddress'||method==='currentPosition')return recorderRun(method,value);
  setBusy(true);
  setError('');
  try{
   const table=supabase.from('household_places');
   let result;
   if(method==='removePlace')result=await table.delete().eq('id',value).select('id').single();
   else{
    const {id,draftId,name,icon,latitude,longitude,radius,shareWithFriends}=value;
    if(!name)throw new Error('Enter a location name.');
    const fields={name,icon,latitude,longitude,radius,share_with_friends:shareWithFriends};
    const update=placeId=>table.update(fields).eq('id',placeId).select('id').single();
    if(id)result=await update(id);
    else{
     const {data:households,error:membershipError}=await supabase.rpc('my_household');
     if(membershipError)throw new Error('Household membership could not be checked. Try again.');
     result=await table.insert({...fields,id:draftId,household_id:households?.[0]?.id??null}).select('id').single();
     // The first insert may have committed even if the response was lost.
     if(result.error?.code==='23505')result=await update(draftId);
    }
   }
   const {error}=result;
   if(error){
    if(error.code==='23514'&&error.message?.includes('household_places_radius_check'))throw new Error('This radius isn’t supported by the server yet. Try 50 m.');
    if(error.code==='23514'&&error.message?.includes('household_places_icon_check'))throw new Error('This icon isn’t supported by the server yet. Choose another icon and try again.');
    if(error.code==='23502'&&error.message?.includes('household_id'))throw new Error('Saving locations without a household isn’t available on the server yet.');
    throw new Error(method==='removePlace'?'The location could not be removed. Try again.':'The location could not be saved. Try again.');
   }
   await refresh();
   return true;
  }catch(error){
   setError(error.message||'Locations are unavailable.');
   return null;
  }finally{
   setBusy(false);
  }
 },[recorderRun,refresh]);
 return <Places household places={places} selfId={selfId}
  memberPoints={memberPoints} mapCenter={mapCenter} peoplePins={peoplePins} run={run} busy={busy} error={error||loadError}/>;
}
