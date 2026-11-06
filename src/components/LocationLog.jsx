import {recorder,recorderAvailable} from '../lib/recorder.js';
import SendReportFeedback from './SendReportFeedback.jsx';

// The one location export: native code builds a single .json.gz, which is sent as
// feedback (stored with the ticket, for you and the letm3go admins only). There is
// no clipboard, share sheet, plain-text or multi-part path here.
async function diagnosticLog(){
 const result=await recorder.diagnosticLogArchive();
 const bytes=Uint8Array.from(atob(result?.base64||''),character=>character.charCodeAt(0));
 if(!bytes.length)throw new Error('The diagnostic log could not be created. Nothing was sent.');
 return {blob:new Blob([bytes],{type:'application/gzip'})};
}
export default function LocationLog(){
 return <section className="location-log" aria-label="Location diagnostics">
  <SendReportFeedback kind="diagnosticLog" title={`Diagnostic log · ${new Date().toLocaleString('en-AU')}`} getReport={diagnosticLog} disabled={!recorderAvailable()} label="Send diagnostic log as feedback"/>
  <p className="muted small-copy">One compressed file with current state and all retained location history, even with no journeys. No coordinates, names or credentials.</p>
 </section>;
}
