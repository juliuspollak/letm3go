import {useState} from 'react';
import {MapPin} from 'lucide-react';
import {recorder} from '../lib/recorder.js';

// The same control for each explicit audience; membership never enables it.
export default function LocationSharingControl({audience='your household',enabled=false,ready=true,onChange,error='',permission,precise}){
 const [pending,setPending]=useState(false),[failure,setFailure]=useState('');
 async function change(){
  setPending(true);setFailure('');
  try{if(!onChange)throw new Error('Location sharing is unavailable. Update the app and try again.');await onChange(!enabled);}
  catch(err){setFailure(err.message||'Could not update location sharing.');}
  finally{setPending(false);}
 }
 const needsSettings=enabled&&(permission==='denied'||permission==='restricted'||precise===false);
 const needsAlways=enabled&&permission&&permission!=='always'&&!needsSettings;
 return <section className="location-sharing-control"><div className="location-sharing-heading"><MapPin size={22} aria-hidden="true"/><div><h3>My location</h3><p>Visible to {audience}</p></div><span className={`location-sharing-status ${enabled?'is-on':''}`}>{ready?(enabled?'On':'Off'):'Checking…'}</span></div><button type="button" role="switch" aria-label={`Share my location with ${audience}`} aria-checked={enabled} disabled={!ready||pending} className={`${enabled?'secondary':'primary'} full`} onClick={change}>{pending?'Updating…':enabled?'Stop sharing my location':'Share my location'}</button><p className="muted small-copy">{enabled?`Your location is shared with ${audience}. You can turn it off here.`:'Your location is private until you turn sharing on.'}</p>{(needsAlways||needsSettings)&&<div className="notice"><p>{needsSettings?'Enable Location and Precise Location in iPhone Settings.':'For sharing while your phone is locked, set Location to Always. Automatic activity recording is optional.'}</p><button type="button" className="secondary full" onClick={async()=>{try{if(needsSettings)await recorder.openSettings();else await recorder.requestPermission(true);}catch{setFailure('Open iPhone Settings → Letm3go → Location to update access.');}}}>Location settings</button></div>}{(failure||error)&&<p role="alert" className="error">{failure||error}</p>}</section>;
}
