import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { verifyAccountSession } from '../lib/userProfile.js';
export default function SessionCheck({session,offline=false,onVerified}){
 const [status,setStatus]=useState(''),[error,setError]=useState(''),[checking,setChecking]=useState(false);
 const generation=useRef(0),feedback=useRef(null);
 useEffect(()=>()=>{generation.current+=1;},[]);
 useEffect(()=>{if(status||error)feedback.current?.scrollIntoView?.({block:'nearest'});},[status,error]);
 async function check(){
  const turn=++generation.current;setChecking(true);setError('');setStatus('Checking your sign-in with Supabase…');
  try{
   const result=await verifyAccountSession(supabase,session,{onProgress:text=>{if(turn===generation.current)setStatus(text);}});
   if(turn===generation.current){setStatus(`${result.provider} sign-in and profile verified. Account ending ${result.userID.slice(-8)}.`);onVerified?.();}
  }catch(err){if(turn===generation.current){setStatus('');setError(err.message||'The check failed. Please reconnect and retry.');}}
  finally{if(turn===generation.current)setChecking(false);}
 }
 return <section ref={feedback} aria-label="Sign-in check"><button className="secondary full" disabled={checking} onClick={check}>{checking?'Checking sign-in…':'Check sign-in'}</button>{offline&&<p className="notice">Your last verification was offline. Reconnect, then check again.</p>}{status&&<p className="notice" role="status" aria-live="polite">{status}</p>}{error&&<p className="error" role="alert">{error}</p>}</section>;
}
