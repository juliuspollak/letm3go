import {useState} from 'react';
import {recorder,recorderAvailable} from '../lib/recorder.js';

// The one location export: native code builds a single .json.gz and opens the iOS
// share sheet. A failure is reported with Retry and never falls back to another
// format, so there is no clipboard, plain-text or multi-part path here.
export default function LocationLog(){
 const [status,setStatus]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function share(){
  setBusy(true);setStatus('');setError('');
  try{
   const result=await recorder.shareDiagnosticLog();
   if(result?.shared)setStatus(`Diagnostic log shared with ${result.events} events.`);
  }catch(err){setError(err?.message||'The diagnostic log could not be created or shared.');}
  finally{setBusy(false);}
 }
 return <section className="location-log" aria-label="Location diagnostics">
  {!error&&<button type="button" className="primary full" disabled={busy||!recorderAvailable()} onClick={share}>{busy?'Preparing diagnostic log…':'Share Diagnostic Log'}</button>}
  <p className="muted small-copy">One compressed file with current state and all retained location history, even with no journeys. No coordinates, names or credentials. Nothing is uploaded unless you share it.</p>
  {status&&<p role="status">{status}</p>}
  {error&&<><p role="alert" className="error">{error}</p><button type="button" className="primary full" disabled={busy} onClick={share}>{busy?'Preparing diagnostic log…':'Retry'}</button></>}
 </section>;
}
