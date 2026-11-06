import {useState} from 'react';
import {Send} from 'lucide-react';
import {Capacitor} from '@capacitor/core';
import {newUUID} from '../lib/uuid.js';
import {REPORT_KINDS} from '../lib/reportKinds.js';

// The one way a report leaves the device: sent as feedback, stored with the
// ticket for the sender and admins only. The number shown is what to quote.
// `getReport` returns {text} or {blob}; a retry reuses the same ticket and file.
export default function SendReportFeedback({kind,title,getReport,state={},disabled=false,label}){
 const [note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[ticket,setTicket]=useState(null);
 const [ids]=useState(()=>({token:newUUID(),report:newUUID()}));
 async function send(){
  if(busy)return;
  setBusy(true);setError('');
  try{
   // Loaded on use: a report screen that never sends needs no account client.
   const [{supabase},{sendReportAsFeedback,feedbackReference}]=await Promise.all([import('../lib/supabase.js'),import('../lib/feedback.js')]);
   if(!supabase)throw new Error('Sending needs a connection to your account.');
   const report=await getReport();
   const sent=await sendReportAsFeedback(supabase,{token:ids.token,reportID:ids.report,kind,title,note,...report,state,native:Capacitor.isNativePlatform()});
   setTicket(feedbackReference(sent));
  }catch(caught){setError(caught?.message||'The report could not be sent. Check your connection and retry.');}
  finally{setBusy(false);}
 }
 if(ticket)return <p role="status" className="notice send-report-done">Sent as feedback <strong>{ticket}</strong>. Quote this number when you ask about it; replies appear under Feedback → My feedback.</p>;
 return <div className="send-report">
  <label>What went wrong? <span className="muted">(optional)</span>
   <textarea rows={2} maxLength={4000} value={note} onChange={event=>setNote(event.target.value)} disabled={busy}/>
  </label>
  {error&&<p role="alert" className="error">{error}</p>}
  <button type="button" className="primary full" disabled={busy||disabled} onClick={()=>void send()}>
   {busy?'Sending…':<><Send size={16} aria-hidden="true"/> {label||`Send ${(REPORT_KINDS[kind]||'report').toLowerCase()} as feedback`}</>}
  </button>
  <p className="muted small-copy">Goes only to you and the letm3go admins, with the report attached. No coordinates, routes or credentials.</p>
 </div>;
}
