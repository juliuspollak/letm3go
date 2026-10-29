import {useState} from 'react';
import Switch from './Switch.jsx';
import {recorder} from '../lib/recorder.js';

// "My location   On/Off" for one audience (friends or household). The switch
// shows the confirmed setting from the server: while a change is in flight it
// shows progress, and a failed change leaves it where it was with the error.
// Turning it on for one audience never touches the other.
export default function LocationSharingRow({audience,enabled=false,ready=true,onChange,error='',permission,precise}){
 const [pending,setPending]=useState(false),[failure,setFailure]=useState('');
 async function change(next){
  setPending(true);setFailure('');
  try{if(!onChange)throw new Error('Location sharing is unavailable. Update the app and try again.');await onChange(next);}
  catch(err){setFailure(err?.message||'Could not update location sharing.');}
  finally{setPending(false);}
 }
 // Only what needs action: no access at all, or not while the phone is locked.
 const needsSettings=enabled&&(permission==='denied'||permission==='restricted'||precise===false);
 const needsAlways=enabled&&!needsSettings&&Boolean(permission)&&permission!=='always';
 const caption=!ready?'Checking…':pending?'Updating…':enabled?(needsSettings?'On · location access is off':`Shared with ${audience}`):'Off';
 return <div className="sharing-row-wrap">
  <div className={`sharing-row${enabled?' is-on':''}`}>
   <div className="sharing-row-text"><span className="sharing-row-title" id={`sharing-${audience}`}>My location</span><span className="sharing-row-caption" aria-live="polite">{caption}</span></div>
   <Switch checked={enabled} pending={pending} disabled={!ready} label={`Share my location with ${audience}`} onChange={change}/>
  </div>
  {(needsSettings||needsAlways)&&<div className="sharing-row-issue" role="status"><span>{needsSettings?'Turn on Location and Precise Location for Letm3go in iPhone Settings.':'Set Location to Always to keep sharing while your phone is locked.'}</span><button type="button" className="text-button" onClick={async()=>{try{if(needsSettings)await recorder.openSettings();else await recorder.requestPermission(true);}catch{setFailure('Open iPhone Settings → Letm3go → Location to update access.');}}}>Settings</button></div>}
  {(failure||error)&&<p role="alert" className="error sharing-row-error">{failure||error}</p>}
 </div>;
}
