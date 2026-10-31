import {invitationLink} from '../lib/invitationLink.js';
import {App as NativeApp} from '@capacitor/app';
import {recorderAvailable} from '../lib/recorder.js';
import DismissibleSheet from './DismissibleSheet.jsx';
import LocationSharingRow from './LocationSharingRow.jsx';
import PeopleGrid from './PeopleGrid.jsx';
import PersonAvatar from './PersonAvatar.jsx';
import SocialActions from './SocialActions.jsx';
import {personStatus,selfStatus} from '../lib/personStatus.js';
import { useEffect, useState } from 'react';
import { Car, ChevronRight, Copy, House, LogOut, Map as MapIcon, Settings, Share2, ShieldCheck, UserPlus, X } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import {newUUID} from '../lib/uuid.js';

// Household: its name, my location for the household, the members (the same
// tiles as Friends), then Family map, Invite and Settings. Shared vehicles,
// membership and leaving live in the settings sheet.
//
// memberLocations: user id → {state, ageSeconds, home, activity, position} from
// the household location rows. A member missing from them is not sharing (the
// household rows include everyone's sharing setting).
export default function Household({vehicles=[],onSaveVehicles,personPhotos={},selfId=null,selfAvatar=null,onMembershipChanged,onShareLive,invitationCode=null,onInviteConsumed,liveEnabled=false,liveReady=true,liveError='',onStopLive,onRetrySharing,permission,precise,onOpenMap,memberLocations={},selfLocation=null,onShowMember=null,onSetHome=null,hasHome=false}){
 const [inviteAccepted,setInviteAccepted]=useState(false),[loadError,setLoadError]=useState(''),[reload,setReload]=useState(0);
 const [membersLoading,setMembersLoading]=useState(false);
 const [sheet,setSheet]=useState(null),[showTransport,setShowTransport]=useState(false),[copied,setCopied]=useState(false);
 const [garage,setGarage]=useState([]),[garageMessage,setGarageMessage]=useState('');
 const [household,setHousehold]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[invite,setInvite]=useState(''),[members,setMembers]=useState([]),[loading,setLoading]=useState(Boolean(supabase)),[leaving,setLeaving]=useState(false);
 useEffect(()=>{
  if(!supabase)return;
  let active=true,listener;
  async function load(){
   setLoading(true);
   try{const {data,error}=await supabase.rpc('my_household');if(!active)return;if(error)throw error;setHousehold(data?.[0]||null);setLoadError('');}
   catch{if(active)setLoadError('Household status could not be loaded. Check your connection and retry.');}
   finally{if(active)setLoading(false);}
  }
  const timer=setTimeout(()=>void load(),0);
  const visible=()=>{if(document.visibilityState!=='hidden')void load();};
  window.addEventListener('online',visible);document.addEventListener('visibilitychange',visible);
  if(recorderAvailable())void NativeApp.addListener('appStateChange',({isActive})=>{if(isActive)void load();}).then(handle=>{if(active)listener=handle;else void handle.remove();}).catch(()=>{});
  return()=>{active=false;clearTimeout(timer);window.removeEventListener('online',visible);document.removeEventListener('visibilitychange',visible);void listener?.remove();};
 },[reload]);
 const householdID=household?.id;
 useEffect(()=>{if(!householdID||!supabase)return;let active=true;queueMicrotask(()=>{if(active)setMembersLoading(true);});supabase.rpc('household_members').then(({data,error})=>{if(!active)return;if(error){setError('Could not load household members. Please reopen the screen.');return;}setMembers(data||[]);}).catch(()=>{if(active)setError('Could not load household members.');}).finally(()=>{if(active)setMembersLoading(false);});return()=>{active=false;};},[householdID]);
 useEffect(()=>{onMembershipChanged?.();},[householdID,onMembershipChanged]);
 async function request(method,params){setBusy(true);setError('');try{if(!supabase)throw new Error('Sign in and connect to set up a household.');const {data,error}=await supabase.rpc(method,params);if(error)throw new Error('Household request failed. Check your connection and invitation, then retry.');return ['leave_household','link_household_vehicle'].includes(method)?true:data;}catch(err){setError(err.message);return null;}finally{setBusy(false);}}
 const closeSheet=()=>{setSheet(null);setLeaving(false);};
 const own=id=>Boolean(selfId)&&String(id).toLowerCase()===String(selfId).toLowerCase();
 const people=members.map(m=>{
  if(own(m.user_id))return {id:m.user_id,userId:m.user_id,name:m.display_name||'Member',self:true,role:m.role==='owner'?'Organiser':null,
   status:selfStatus({enabled:liveEnabled,state:selfLocation?.state,ageSeconds:selfLocation?.ageSeconds,home:selfLocation?.home,activity:selfLocation?.activity,permission,precise})};
  const location=memberLocations[m.user_id]||{state:'off'};
  return {id:m.user_id,userId:m.user_id,name:m.display_name||'Member',role:m.role==='owner'?'Organiser':null,status:personStatus(location),
   onSelect:location.position&&onShowMember?()=>onShowMember(location.position,m.user_id):null};
 });
 const inviteMessage=invite&&household?`Join my household on Letm3go: ${invitationLink('household',invite)}\n\nIf the link does not open, enter this code under Social → Household: ${invite}. Expires in 48 hours.`:'';
 async function createInvite(){const data=await request('invite_to_household');if(data){setInvite(data);setCopied(false);setSheet('invite');}}
 return <section className="social-screen household-screen" aria-label="Household">
  {loading&&!household&&<p role="status" className="social-hint">Loading household…</p>}
  {loadError&&<div className="notice" role="alert"><p>{loadError}</p><button type="button" className="secondary full" onClick={()=>setReload(value=>value+1)}>Retry household</button></div>}
  {household?<>
   <div className="social-heading household-title"><h2>{household.name}</h2>{!membersLoading&&members.length>0&&<span className="social-count">{members.length}</span>}</div>
   {inviteAccepted&&<p role="status" className="notice">You joined {household.name}. Turn on My location to appear on the family map.</p>}
   <LocationSharingRow audience="household" enabled={liveEnabled} ready={liveReady} error={liveError} permission={permission} precise={precise} onChange={async enabled=>{if(enabled){if(!onShareLive)throw new Error('Update Letm3go to enable household location sharing.');await onShareLive();}else{if(!onStopLive)throw new Error('Location sharing is unavailable.');await onStopLive();}}}/>
   {!liveReady&&onRetrySharing&&<button type="button" className="text-button" onClick={onRetrySharing}>Retry location status</button>}
   <h3 className="social-subheading">Members</h3>
   {membersLoading&&!members.length?<p role="status" className="social-hint">Loading members…</p>:<PeopleGrid people={people} photos={personPhotos} selfId={selfId} selfAvatar={selfAvatar} label="Members"/>}
   {!membersLoading&&!members.length&&<p className="social-empty">No members available. Reopen to retry.</p>}
   <SocialActions label="Household actions" actions={[
    onOpenMap&&{id:'map',label:'Family map',icon:MapIcon,onClick:onOpenMap},
    household.role==='owner'&&{id:'invite',label:'Invite',icon:UserPlus,onClick:createInvite,disabled:busy||loading},
    {id:'settings',label:'Settings',icon:Settings,onClick:()=>setSheet('settings'),expanded:sheet==='settings'}
   ]}/>
   {sheet==='invite'&&invite&&<div className="modal-backdrop" onClick={closeSheet}><DismissibleSheet label={`Invite to ${household.name}`} onClose={closeSheet}>
    <div className="social-sheet-head"><h2>Invite to {household.name}</h2><button type="button" className="icon-button" aria-label="Close" onClick={closeSheet}><X size={20}/></button></div>
    <p className="social-hint">Share privately. Valid for 48 hours and one use.</p>
    <button type="button" className="primary full" onClick={async()=>{try{if(navigator.share)await navigator.share({title:'Letm3go household invitation',text:inviteMessage});else{await navigator.clipboard.writeText(inviteMessage);setCopied(true);}}catch(error){if(error?.name!=='AbortError')setError('Unable to share. Copy the code below instead.');}}}><Share2 size={17}/> Share invitation</button>
    <button className="secondary full" type="button" onClick={async()=>{try{await navigator.clipboard.writeText(invite);setCopied(true);}catch{setCopied(false);}}}><Copy size={16}/> {copied?'Copied':'Copy code'}</button>
    <details><summary>Invitation code</summary><code>{invite}</code></details>
    {error&&<p role="alert" className="error">{error}</p>}
   </DismissibleSheet></div>}
   {sheet==='settings'&&<div className="modal-backdrop" onClick={closeSheet}><DismissibleSheet label="Household settings" onClose={closeSheet}>
    <div className="social-sheet-head"><h2>Household settings</h2><button type="button" className="icon-button" aria-label="Close" onClick={closeSheet}><X size={20}/></button></div>
    <div className="grouped-list">
     <button type="button" className="grouped-row" aria-expanded={showTransport} onClick={()=>setShowTransport(v=>!v)}><span className="grouped-row-label"><Car size={18} aria-hidden="true"/>Shared vehicles</span><ChevronRight size={18} className="grouped-chevron" aria-hidden="true"/></button>
     {showTransport&&<div className="grouped-panel household-garage">
      <button type="button" className="secondary full" disabled={busy} onClick={async()=>{const result=await request('my_household_vehicles');if(result)setGarage(result);}}>View household vehicles</button>
      {garage.map(v=><div key={v.id} className="household-vehicle-link"><strong>{v.display_name}</strong><label>Match one of your existing vehicles<select aria-label={`Match ${v.display_name}`} value={v.local_vehicle_id||''} disabled={busy} onChange={async e=>{const id=e.target.value;if(!id)return;const result=await request('link_household_vehicle',{p_household_vehicle:v.id,p_local_vehicle:id});if(result!==null){setGarage(items=>items.map(item=>item.id===v.id?{...item,local_vehicle_id:id}:item));setGarageMessage('Linked to your existing vehicle. No duplicate was created.');}}}><option value="">Not linked</option>{vehicles.filter(v=>!v.archived).map(car=><option key={car.id} value={car.id}>{car.name}</option>)}</select></label>{!v.local_vehicle_id&&onSaveVehicles&&!vehicles.some(car=>car.name.trim().toLowerCase()===v.display_name.trim().toLowerCase())&&<button type="button" className="secondary" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{const local={id:newUUID(),name:v.display_name,make:v.make||'',model:v.model||'',category:'car',source:'manual',householdVehicleID:v.id};await onSaveVehicles([...vehicles,local]);const {error:linkError}=await supabase.rpc('link_household_vehicle',{p_household_vehicle:v.id,p_local_vehicle:local.id});if(linkError)throw linkError;setGarage(items=>items.map(item=>item.id===v.id?{...item,local_vehicle_id:local.id}:item));setGarageMessage('Shared vehicle added to My Collection once.');}catch{setError('The household car could not be fully linked. Check My Collection and retry if necessary.');}finally{setBusy(false);}}}>Add to My Collection</button>}</div>)}
      <form onSubmit={async e=>{e.preventDefault();const form=e.currentTarget;const data=new FormData(form);const id=await request('add_household_vehicle',{p_name:data.get('vehicle_name'),p_make:'',p_model:''});if(id){const updated=await request('my_household_vehicles');if(updated)setGarage(updated);form.reset();}}}><label>Add a shared vehicle<input name="vehicle_name" required maxLength={100} placeholder="Vehicle name"/></label><button type="submit" className="secondary full" disabled={busy}>Add household vehicle</button></form>
      {garageMessage&&<p role="status" className="notice">{garageMessage}</p>}
     </div>}
     {onSetHome&&<button type="button" className="grouped-row" onClick={()=>{closeSheet();onSetHome();}}><span className="grouped-row-label"><House size={18} aria-hidden="true"/>{hasHome?'Home place':'Set Home'}</span><ChevronRight size={18} className="grouped-chevron" aria-hidden="true"/></button>}
    </div>
    <h3 className="social-sheet-label">Members</h3>
    <ul className="grouped-list">{members.map(m=><li key={m.user_id} className="grouped-row"><span className="social-manage-person"><PersonAvatar name={m.display_name||'Member'} userId={m.user_id} selfId={selfId} photos={personPhotos} selfAvatar={selfAvatar} size="sm"/>{own(m.user_id)?'You':m.display_name||'Member'}</span><span className="grouped-value">{m.role==='owner'?'Organiser':'Member'}</span></li>)}</ul>
    <p className="social-hint"><ShieldCheck size={14} aria-hidden="true"/> Membership never shares your location or past activities. If the organiser leaves, another member becomes organiser.</p>
    <div className="grouped-list grouped-danger">
     {!leaving?<button type="button" className="grouped-row danger-row" disabled={busy||loading} onClick={()=>setLeaving(true)}><span className="grouped-row-label"><LogOut size={18} aria-hidden="true"/>Leave household</span></button>
     :<div className="grouped-panel" role="group" aria-label="Confirm leaving"><p>Leave {household.name}? Your private activities stay yours. If you are the organiser, another member becomes organiser; an empty household is removed.</p><div className="social-inline-actions"><button type="button" className="secondary" onClick={()=>setLeaving(false)}>Stay</button><button type="button" className="primary danger" disabled={busy||loading} onClick={async()=>{if(await request('leave_household')){setHousehold(null);setMembers([]);setInvite('');closeSheet();}}}>Confirm leave</button></div></div>}
    </div>
    {error&&<p role="alert" className="error">{error}</p>}
   </DismissibleSheet></div>}
  </>:!loading&&!loadError?<>
   <div className="social-heading"><h2>Household</h2></div>
   <p className="social-hint">Share a family map and vehicles with the people you live with.</p>
   <form className="social-code-form" onSubmit={async e=>{e.preventDefault();const name=new FormData(e.currentTarget).get('name');const data=await request('create_household',{p_name:name});if(data)setHousehold(data[0]);}}><label>Household name<input name="name" required maxLength={100} placeholder="Our household"/></label><button className="primary full" disabled={busy||loading}>Create household</button></form>
   <form className="social-code-form" onSubmit={async e=>{e.preventDefault();const token=new FormData(e.currentTarget).get('invitation').trim();const data=await request('accept_household_invitation',{p_token:token});if(data){setHousehold(data[0]);setInviteAccepted(true);onInviteConsumed?.();}}}><label>Have an invitation code?<input key={invitationCode||'manual'} name="invitation" defaultValue={invitationCode||''} required placeholder="Paste the invitation code"/></label><button className="secondary full" disabled={busy||loading}>Join household</button></form>
   <p className="social-hint"><ShieldCheck size={14} aria-hidden="true"/> Membership never shares your location or past activities.</p>
  </>:null}
  {error&&!sheet&&<p role="alert" className="error">{error}</p>}
 </section>;
}
