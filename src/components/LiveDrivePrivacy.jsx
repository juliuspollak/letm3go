import {useEffect,useState} from 'react';
import {EyeOff} from 'lucide-react';
import {recorder} from '../lib/recorder.js';
import {supabase} from '../lib/supabase.js';
import {flushPendingHides,hideLiveActivity,hideStatus} from '../lib/hideLiveActivity.js';

// One tap, while recording, to keep this activity private from live viewers. Three honest
// states: not asked; stopped on this phone but the server has not confirmed (so someone
// watching may still see the route already sent); confirmed (nobody can see it). The
// confirmation is retried until it arrives.
export const RETRY_MS=15000;
export default function LiveDrivePrivacy({trip,deps={recorder,client:supabase}}){
 const [status,setStatus]=useState(()=>hideStatus(trip.id)),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  if(status!=='pending')return undefined;
  const timer=setInterval(async()=>{try{await flushPendingHides(deps.client);setStatus(hideStatus(trip.id));}catch{/* keep pending and retry; never claim confirmation */}},RETRY_MS);
  return()=>clearInterval(timer);
 },[status,trip.id,deps.client]);
 if(status==='confirmed')return <p className="live-private" role="status"><EyeOff size={15}/> Private: nobody can see this activity while it is recorded, and it will not be shared automatically.</p>;
 if(status==='pending')return <p className="live-private" role="status"><EyeOff size={15}/> Stopped sharing from this phone. Waiting to confirm with the server: until then, anyone watching may still see the route already sent. It will not be shared automatically.</p>;
 async function hide(){
  setBusy(true);setError('');
  try{await hideLiveActivity(trip.id,deps);setStatus(hideStatus(trip.id));}
  catch{setError('Could not make it private. Try again.');}
  finally{setBusy(false);}
 }
 return <div className="live-private-row"><button type="button" className="text-button" disabled={busy} onClick={hide}><EyeOff size={15}/> Keep this activity private</button>{error&&<p role="alert" className="error">{error}</p>}</div>;
}
