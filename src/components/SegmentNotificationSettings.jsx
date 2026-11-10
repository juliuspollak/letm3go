import {useEffect,useState} from 'react';
import {loadNotificationSettings,saveNotificationSettings} from '../lib/segmentsApi.js';

// Which segment notifications to receive. Stored on the server, because the
// server decides whether to write them; they reach the in-app list whether or
// not iOS notifications are allowed. Admin changes to your segments always arrive.
export default function SegmentNotificationSettings({owner}){
 const [settings,setSettings]=useState(null),[error,setError]=useState('');
 useEffect(()=>{
  let alive=true;
  loadNotificationSettings(owner).then(value=>{if(alive)setSettings(value);}).catch(()=>{if(alive)setError('Segment notification settings are unavailable offline.');});
  return()=>{alive=false;};
 },[owner]);
 if(!settings)return error?<p className="muted small-copy">{error}</p>:null;
 const change=async(key,value)=>{
  const previous=settings;setSettings({...settings,[key]:value});setError('');
  try{await saveNotificationSettings(owner,{...settings,[key]:value});}catch(failure){setSettings(previous);setError(failure.message);}
 };
 return <fieldset className="segment-notification-settings">
  <legend>Segment notifications</legend>
  <label><input type="checkbox" checked={settings.segment_community} onChange={event=>void change('segment_community',event.target.checked)}/> When others complete or set a record on my segments</label>
  <label><input type="checkbox" checked={settings.segment_personal} onChange={event=>void change('segment_personal',event.target.checked)}/> My personal bests</label>
  {error&&<p role="alert" className="error">{error}</p>}
 </fieldset>;
}
