import {useState} from 'react';
import {EyeOff} from 'lucide-react';
import {recorder} from '../lib/recorder.js';
import {supabase} from '../lib/supabase.js';
import {hideLiveActivity,isLiveHidden} from '../lib/hideLiveActivity.js';

// One tap, while recording, to keep this activity private from live viewers.
export default function LiveDrivePrivacy({trip,deps={recorder,client:supabase}}){
 const [hidden,setHidden]=useState(()=>isLiveHidden(trip.id)),[busy,setBusy]=useState(false),[error,setError]=useState('');
 if(hidden)return <p className="live-private" role="status"><EyeOff size={15}/> Private: nobody can see this activity while it is recorded, and it will not be shared automatically.</p>;
 async function hide(){
  setBusy(true);setError('');
  try{await hideLiveActivity(trip.id,deps);setHidden(true);}
  catch{setError('Could not make it private. Try again.');}
  finally{setBusy(false);}
 }
 return <div className="live-private-row"><button type="button" className="text-button" disabled={busy} onClick={hide}><EyeOff size={15}/> Keep this activity private</button>{error&&<p role="alert" className="error">{error}</p>}</div>;
}
