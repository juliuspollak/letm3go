import {useEffect,useState} from 'react';
import {teslaRecordingRequest,openTeslaPairingURL} from '../lib/tesla.js';
import {teslaConnected} from '../lib/teslaStatus.js';

export default function TeslaRecording({vehicle,accountStatus,compact=false}){
 const [status,setStatus]=useState(null),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [busy,setBusy]=useState(false),[consent,setConsent]=useState(false),[loaded,setLoaded]=useState(false);
 useEffect(()=>{
  let current=true;
  teslaRecordingRequest('status',{vehicleID:vehicle.id})
   .then(result=>{if(current){setStatus(result);setError('');}})
   .catch(failure=>{if(current){setStatus(null);setError(failure.message);}})
   .finally(()=>{if(current)setLoaded(true);});
  return()=>{current=false;};
 },[vehicle.id]);

 async function refresh(){
  try{setStatus(await teslaRecordingRequest('status',{vehicleID:vehicle.id}));}
  catch(failure){setStatus(null);setError(previous=>previous||failure.message);}
  finally{setLoaded(true);}
 }
 async function act(action,params={}){
  setBusy(true);setError('');setMessage('');
  try{
   if(action!=='status'){
    const result=await teslaRecordingRequest(action,{vehicleID:vehicle.id,...params});
    if(result.url)await openTeslaPairingURL(result.url);
    setMessage(result.message||result.compatibility?.reason|| (result.disabled?'Automatic recording disabled and vehicle streaming removed.':''));
    if(action==='enable')setConsent(false);
   }
  }catch(failure){setError(failure.message);}
  finally{await refresh();setBusy(false);}
 }

 const label=status?.label||(loaded?'Recording status unavailable':'Checking recording status…');
 if(compact)return <small>{label}</small>;
 const actions=status?.actions||{},setting=status?.setting;
 const connected=status?.accountConnected??(accountStatus?teslaConnected(accountStatus):null);
 return <section className="garage-tesla-summary">
  <h3>Automatic recording</h3>
  <p role="status" className="small-copy">{label}</p>
  <dl className="garage-tesla-facts">
   <div><dt>Tesla account</dt><dd>{connected===null?'Not verified':connected?'Connected':'Not connected'}</dd></div>
   <div><dt>Vehicle</dt><dd>Imported to My Collection</dd></div>
   {status&&<>
    <div><dt>Receiver</dt><dd>{status.receiverReady?'Online':'Unavailable'}</dd></div>
    <div><dt>Virtual key</dt><dd>{setting?.keyRequired===false?'Use vehicle Safety streaming toggle':setting?.keyPaired?'Paired':actions.pair?'Pairing required':'Not verified'}</dd></div>
    <div><dt>Telemetry configuration</dt><dd>{setting?.configSynced?'Verified by vehicle':status.code==='configuration_pending'?'Waiting for verification':'Not verified'}</dd></div>
    <div><dt>Vehicle stream</dt><dd>{typeof setting?.streamConnected==='boolean'?(setting.streamConnected?'Connected':'Disconnected / may be asleep'):'Not reported'}</dd></div>
    <div><dt>Last telemetry</dt><dd>{setting?.lastReceived?new Date(setting.lastReceived).toLocaleString():'None yet'}</dd></div>
    {setting?.enabledSince&&<div><dt>Recording enabled</dt><dd>{new Date(setting.enabledSince).toLocaleString()}</dd></div>}
   </>}
  </dl>
  {status?.reason&&<p className="notice">{status.reason}</p>}
  <div className="garage-detail-actions">
   <button type="button" className="text-button" disabled={busy||!loaded} onClick={()=>act('status')}>Refresh recording status</button>
   {actions.check&&<button type="button" className="secondary" disabled={busy} onClick={()=>act('check')}>Check vehicle setup</button>}
   {actions.pair&&<button type="button" className="secondary" disabled={busy} onClick={()=>act('pairingLink')}>Pair Letm3go key</button>}
  </div>
  {actions.disable&&<button type="button" className="secondary full" disabled={busy} onClick={()=>act('disable')}>{status.code==='removal_pending'?'Retry removing vehicle streaming':'Disable automatic recording'}</button>}
  {actions.enable&&<>
   <label className="checkbox-label"><input type="checkbox" checked={consent} disabled={busy} onChange={event=>setConsent(event.target.checked)}/> Record future journeys and vehicle locations automatically.</label>
   <button type="button" className="primary full" disabled={busy||!consent} onClick={()=>act('enable',{consent:true})}>Enable automatic recording</button>
  </>}
  {(setting?.enabled||setting?.sharingHousehold)&&<label className="checkbox-label"><input type="checkbox" checked={!!setting.sharingHousehold} disabled={busy} onChange={event=>act('shareHousehold',{enabled:event.target.checked,consent:event.target.checked})}/> Share future vehicle journeys with my household</label>}
  <p className="muted small-copy">Tesla records future vehicle journeys independently of your iPhone once telemetry is verified.</p>
  {setting?.error&&<p className="notice">{setting.error}</p>}
  {message&&<p role="status" className="notice">{message}</p>}
  {error&&<p role="alert" className="error">{error}</p>}
 </section>;
}
