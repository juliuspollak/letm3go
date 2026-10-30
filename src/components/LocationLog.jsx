import {useState} from 'react';
import {recorder,recorderAvailable} from '../lib/recorder.js';
import {copyText} from '../lib/clipboard.js';
import {locationReportChunks} from '../lib/locationReport.js';

export default function LocationLog(){
 const [chunks,setChunks]=useState([]),[status,setStatus]=useState(''),[busy,setBusy]=useState(false),[selected,setSelected]=useState(0);
 async function copy(index,parts=chunks){
  setSelected(index);
  setStatus(await copyText(parts[index])?`Copied part ${index+1} of ${parts.length}. Paste through the END marker.`:'Copy unavailable. Select and copy the full text below.');
 }
 async function prepare(){
  setBusy(true);setStatus('');setChunks([]);setSelected(0);
  try{
   const report=await recorder.exportLocationDiagnostics();const parts=locationReportChunks(report);setChunks(parts);
   if(parts.length===1)await copy(0,parts);
   else setStatus(`The complete retained log needs ${parts.length} parts. Copy and paste each numbered part in order; nothing has been truncated.`);
  }catch{setStatus('The location log could not be prepared. Install the updated iPhone app and try again.');}
  finally{setBusy(false);}
 }
 return <section className="location-log" aria-label="Full location diagnostics">
  <button type="button" className="primary full" disabled={busy||!recorderAvailable()} onClick={prepare}>{busy?'Preparing location log…':'Copy Full Location Log'}</button>
  <p className="muted small-copy">Includes current state and retained location history, even with no journeys. No coordinates, names or credentials. Nothing is uploaded.</p>
  {status&&<p role="status">{status}</p>}
  {chunks.length>1&&<div className="detail-actions">{chunks.map((_,index)=><button type="button" className="secondary" key={index} onClick={()=>copy(index)}>Copy part {index+1} of {chunks.length}</button>)}</div>}
  {chunks.length>0&&<details><summary>Full location log text{chunks.length>1?` · part ${selected+1} of ${chunks.length}`:''}</summary><textarea aria-label="Full location log text" readOnly rows={14} style={{width:'100%'}} value={chunks[selected]}/></details>}
 </section>;
}
