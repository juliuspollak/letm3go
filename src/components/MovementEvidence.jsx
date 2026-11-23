import {useState} from 'react';
import {recorder} from '../lib/recorder.js';

export default function MovementEvidence(){
 const [ids,setIds]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const recover=async id=>{
  setBusy(true);setError('');
  try{
   const result=await recorder.recoverMovementEvidence(id?{id}:{});
   if(!id)setIds(result.ids||[]);
  }catch(err){setError(err.message);}
  finally{setBusy(false);}
 };
 return <section className="tracking-toggle">
  <div><strong>Private movement evidence</strong>
   <p className="muted small-copy">Recover routes that the recorder could not classify. Exports include precise locations.</p>
   {ids?.length===0&&<p className="muted small-copy">No evidence to recover.</p>}
   {ids?.map(id=><button key={id} type="button" className="text-button" disabled={busy} onClick={()=>recover(id)}>Export route {id.slice(0,8)}</button>)}
   {error&&<p role="alert" className="error">{error}</p>}
  </div>
  <button type="button" className="secondary" disabled={busy} onClick={()=>recover()}>Find routes</button>
 </section>;
}
