import {useEffect,useState} from 'react';
import {PARTICIPATION,deleteMyEfforts,loadNotificationSettings,saveNotificationSettings} from '../lib/segmentsApi.js';

// Segment efforts and notifications, in Account & settings. Stored on the server,
// because the server decides what to store and whom to tell; notifications reach
// the in-app list whether or not iOS notifications are allowed. A segment you
// create is public, but your rides never are: only a time on a segment is sent,
// anonymously unless you choose to show your name. Admin changes to your
// segments always arrive.
export default function SegmentNotificationSettings({owner}){
 const [settings,setSettings]=useState(null),[error,setError]=useState(''),[removed,setRemoved]=useState(null),[busy,setBusy]=useState(false),[saving,setSaving]=useState(false);
 useEffect(()=>{
  let alive=true;
  loadNotificationSettings(owner).then(value=>{if(alive)setSettings(value);}).catch(()=>{if(alive)setError('Segment settings are unavailable offline.');});
  return()=>{alive=false;};
 },[owner]);
 if(!settings)return error?<p className="muted small-copy">{error}</p>:null;
 const change=async(key,value)=>{
  if(saving||busy)return;
  const previous=settings;setSaving(true);setSettings({...settings,[key]:value});setError('');setRemoved(null);
  try{await saveNotificationSettings(owner,{...settings,[key]:value});}catch(failure){setSettings(previous);setError(failure.message);}finally{setSaving(false);}
 };
 const remove=async()=>{
  setBusy(true);setError('');
  try{setRemoved(await deleteMyEfforts());}catch(failure){setError(failure.message);}finally{setBusy(false);}
 };
 return <>
  <fieldset className="segment-notification-settings" disabled={saving||busy}>
   <legend>Segment efforts</legend>
   <p className="muted small-copy">When a ride, walk or run passes along a community segment, only the time on that segment is sent: never your route or activity.</p>
   {PARTICIPATION.map(([value,label,help])=><label key={value}><input type="radio" name="segment-participation" value={value} checked={settings.segment_participation===value} onChange={()=>void change('segment_participation',value)}/>
    <span><strong>{label}</strong><small className="muted">{help}</small></span></label>)}
   {settings.segment_participation==='off'&&<button type="button" className="secondary" disabled={busy} onClick={()=>void remove()}>{busy?'Removing…':'Remove my earlier efforts'}</button>}
   {removed!==null&&<p role="status" className="muted small-copy">{removed?`${removed} effort${removed===1?'':'s'} removed.`:'There were no efforts to remove.'}</p>}
  </fieldset>
  <fieldset className="segment-notification-settings" disabled={saving||busy}>
   <legend>Segment notifications</legend>
   <label><input type="checkbox" checked={settings.segment_community} onChange={event=>void change('segment_community',event.target.checked)}/><span>When others complete or set a record on my segments</span></label>
   <label><input type="checkbox" checked={settings.segment_personal} onChange={event=>void change('segment_personal',event.target.checked)}/><span>My personal bests</span></label>
  </fieldset>
  {error&&<p role="alert" className="error">{error}</p>}
 </>;
}
