import {useCallback,useEffect,useState} from 'react';
import {supabase} from '../lib/supabase.js';

// An invitation from a friend to join their household. Joining shares location, so it
// says so and waits for an answer.
export default function HouseholdRequests({onJoined}){
 const [requests,setRequests]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const load=useCallback(async()=>{
  if(!supabase)return;
  // Before the backend update this call does not exist, and there is nothing to show.
  const {data,error:failed}=await supabase.rpc('my_household_requests');
  setRequests(failed?[]:data||[]);
 },[]);
 useEffect(()=>{const timer=setTimeout(()=>void load(),0);return()=>clearTimeout(timer);},[load]);
 async function answer(request,accept){
  setBusy(true);setError('');
  const {error:failed}=await supabase.rpc('respond_household_request',{p_id:request.id,p_accept:accept});
  setBusy(false);
  if(failed){setError(failed.message||'That could not be saved. Please retry.');return;}
  await load();
  if(accept)onJoined?.();
 }
 if(!requests.length)return null;
 return <div className="household-requests">{requests.map(request=><div className="notice" role="status" key={request.id}>
  <strong>{request.invited_by_name} invited you to {request.household_name}</strong>
  <p className="small-copy">Household members can see each other on the map once they turn on location sharing.</p>
  <div className="detail-actions"><button type="button" className="secondary" disabled={busy} onClick={()=>answer(request,false)}>Decline</button><button type="button" className="primary" disabled={busy} onClick={()=>answer(request,true)}>Join</button></div>
 </div>)}{error&&<p role="alert" className="error">{error}</p>}</div>;
}
