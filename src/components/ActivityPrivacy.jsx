import { useEffect,useRef,useState } from 'react';
import { createPortal } from 'react-dom';
import { Lock,Globe,ShieldQuestion,X,Check } from 'lucide-react';
import { useAuth } from '../lib/AuthContext.jsx';
import { supabase } from '../lib/supabase.js';
import { recorder } from '../lib/recorder.js';
import { sharingRequest,publishActivity,makeActivityPrivate } from '../lib/activitySharing.js';
import { publicationPreview } from '../lib/activityPrivacy.js';
import JourneyMap from './JourneyMap.jsx';
export default function ActivityPrivacy({trip,places}){
 const auth=useAuth(),dialog=useRef(null),[open,setOpen]=useState(false),[audience,setAudience]=useState(null),[choice,setChoice]=useState('private'),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 useEffect(()=>{if(!open)return;let alive=true;sharingRequest(supabase,'status',trip.id).then(result=>{if(alive){setAudience(result.audience);setChoice(result.audience==='public'?'public':'private');}}).catch(()=>{if(alive)setError('Online sharing status is unavailable. You can retry, or explicitly make this activity private.');}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[trip.id,trip.updatedAt,open]);
 useEffect(()=>{if(open){const element=dialog.current;element?.showModal();return()=>element?.close();}},[open]);
 const preview=publicationPreview(trip,places,[]);
 const mapped={route:preview.points.map(p=>[p.latitude,p.longitude]),routeSegments:preview.points.reduce((segments,p)=>{(segments[p.segment]??=[]).push([p.latitude,p.longitude]);return segments;},[]).filter(Boolean),photos:[]};
 async function save(){setBusy(true);setError('');setMessage('');try{
  if(choice==='private'){await makeActivityPrivate(supabase,trip.id);setAudience('private');setMessage('Private. Access to the shared copy has been revoked. Copies others already saved cannot be recalled.');}
  else {await sharingRequest(supabase,'status',trip.id);const state=await recorder.getState();await publishActivity({client:supabase,state,id:trip.id,reviewedTrip:trip,receipts:auth.preferences.syncReceipts||{},checkpoint:syncReceipts=>auth.savePreferences({syncReceipts})});setAudience('public');setMessage('Public. The reviewed route copy is now available to others. Photos were not published.');}
 }catch(err){setAudience(null);setError(err.message);}finally{setBusy(false);}}
 const Icon=audience==='public'?Globe:audience==='private'?Lock:ShieldQuestion;
 const unchanged=choice===audience;
 return <><button type="button" className="icon-button activity-private-icon" aria-label={`Activity privacy: ${audience||'check status'}`} onClick={()=>{setError('');setMessage('');setConsent(false);setLoading(true);setOpen(true);}}><Icon size={16}/></button>{open&&createPortal(<dialog ref={dialog} className="activity-privacy-dialog" aria-labelledby="privacy-title" onCancel={event=>{event.preventDefault();if(!busy)setOpen(false);}}>
 <header className="privacy-header"><h2 id="privacy-title">Who can see this trip?</h2><button type="button" className="icon-button" aria-label="Close privacy settings" disabled={busy} onClick={()=>setOpen(false)}><X size={20}/></button></header>
 <div className="privacy-content"><p className="small-copy">{loading?'Checking current setting…':audience==='private'?'Only you can see this trip.':audience==='public'?'A public copy of this trip is shared.':'Current sharing setting could not be verified.'}</p>
 <div className="privacy-options">{[['private',Lock,'Private','Only you'],['public',Globe,'Public','Anyone with the link']].map(([value,OptionIcon,title,subtitle])=><label key={value} className={`privacy-option ${choice===value?'selected':''}`}><input type="radio" name="activity-privacy" aria-label={`${title} · ${subtitle}`} value={value} checked={choice===value} disabled={busy||loading} onChange={()=>{setChoice(value);setConsent(false);setMessage('');}}/><OptionIcon size={21}/><span><strong>{title}</strong><small>{subtitle}</small></span>{audience===value&&<span className="privacy-current"><Check size={13}/>Current</span>}</label>)}</div>
 {choice==='public'&&audience!=='public'&&<section className="privacy-preview"><h3>Preview public copy</h3><p className="small-copy">Your title, description and route below will be shared. Home and Work areas are hidden, but landmarks may still identify places. Photos and private notes stay private.</p><strong>{preview.title}</strong>{preview.description&&<p>{preview.description}</p>}{mapped.route.length>0?<JourneyMap journeys={[mapped]}/>:<p className="small-copy">No route points remain after privacy masking.</p>}<label className="checkbox-label"><input type="checkbox" checked={consent} disabled={busy||loading} onChange={e=>setConsent(e.target.checked)}/>I agree to upload this trip and saved Home/Work locations privately, and publish the reviewed copy.</label></section>}
 {choice==='private'&&audience==='public'&&<p className="small-copy">The public link will stop working. Copies already saved by others cannot be recalled.</p>}
 {message&&<p role="status" className="notice">{message}</p>}{error&&<p role="alert" className="error">{error}</p>}</div>
 {!unchanged&&<footer className="privacy-footer"><button type="button" className="primary" disabled={busy||loading||(choice==='public'&&!consent)} onClick={save}>{busy?'Saving…':choice==='private'?'Make private':'Share publicly'}</button></footer>}
 </dialog>,document.body)}</>;
}
