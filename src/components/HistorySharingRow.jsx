import {useEffect,useState} from 'react';
import {readHistorySharing,runHistoryBackfill,setHistorySharing} from '../lib/historySharing.js';

// Under "New activities": share my EARLIER completed activities with the household too. Only I can switch this on
// (membership alone never does), it asks first, hides Home and Work like every share, and can be stopped, which
// takes those shares back. Hidden until the database knows about it.
export default function HistorySharingRow({client,autoEnabled=true}){
 const [state,setState]=useState(null),[confirming,setConfirming]=useState(false),[busy,setBusy]=useState(false),[progress,setProgress]=useState(null),[message,setMessage]=useState('');
 const load=async()=>{const value=await readHistorySharing(client);setState(value);return value;};
 useEffect(()=>{let alive=true;readHistorySharing(client).then(value=>{if(alive)setState(value);});return()=>{alive=false;};},[client]);
 async function share(){
  setBusy(true);setMessage('');setProgress(null);
  try{
   const result=await runHistoryBackfill({client,onProgress:setProgress});
   if(result.needsHome)setMessage('Save your Home place first (Profile › Saved places) so your routes can be hidden around it, then try again.');
   else if(result.remaining>0)setMessage(`${result.remaining} could not be shared yet. Try again later.`);
   else setMessage(result.published?`Shared ${result.published} earlier ${result.published===1?'activity':'activities'}.`:'Nothing more to share.');
  }catch(error){setMessage(error.message);}
  setBusy(false);setProgress(null);await load();
 }
 async function agree(){
  setBusy(true);setMessage('');
  try{await setHistorySharing(client,true);setConfirming(false);await load();}
  catch(error){setMessage(error.message);setBusy(false);return;}
  setBusy(false);await share();
 }
 async function stop(){
  setBusy(true);setMessage('');
  try{await setHistorySharing(client,false);setMessage('Earlier activities are no longer shared.');}catch(error){setMessage(error.message);}
  setBusy(false);await load();
 }
 // Offered while household sharing is on; if it was switched off after agreeing, the control to stop is still here.
 if(!state||(!autoEnabled&&!state.enabled))return null;
 return <div className="sharing-row sharing-row--history">
  <div className="sharing-row-text">
   <span className="sharing-row-title">Earlier activities</span>
   <span className="sharing-row-caption" aria-live="polite">{busy?(progress?`Sharing… ${progress.remaining} left`:'Working…'):state.enabled?(autoEnabled?`Shared with your household${state.waiting?` · ${state.waiting} waiting`:''}`:'Paused while sharing new activities is off. Stop sharing to take them back.'):'Not shared. Only activities you record from now on are.'}</span>
   {confirming&&<span className="sharing-row-caption">Share all your earlier completed activities with your household? Your Home and Work are hidden, and you can make any one private or stop at any time.</span>}
   {message&&<span className="sharing-row-caption" role="status">{message}</span>}
  </div>
  {state.enabled
   ?<span className="sharing-row-actions">{Number(state.waiting)>0&&<button type="button" className="text-button" disabled={busy} onClick={share}>Share now</button>}<button type="button" className="text-button" disabled={busy} onClick={stop}>Stop sharing</button></span>
   :confirming
    ?<span className="sharing-row-actions"><button type="button" className="text-button" disabled={busy} onClick={()=>setConfirming(false)}>Cancel</button><button type="button" className="text-button" disabled={busy} onClick={agree}>Share them</button></span>
    :<button type="button" className="text-button" disabled={busy} onClick={()=>setConfirming(true)}>Share earlier activities</button>}
 </div>;
}
