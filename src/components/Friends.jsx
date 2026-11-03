import InviteSharingPrompt from './InviteSharingPrompt.jsx';
import InviteComposer from './InviteComposer.jsx';
import DismissibleSheet from './DismissibleSheet.jsx';
import LocationSharingRow from './LocationSharingRow.jsx';
import PeopleGrid from './PeopleGrid.jsx';
import PersonAvatar from './PersonAvatar.jsx';
import SocialActions from './SocialActions.jsx';
import {personStatus,selfStatus} from '../lib/personStatus.js';
import {connectedPeople} from '../lib/people.js';
import {useCallback,useEffect,useState} from 'react';
import {supabase} from '../lib/supabase.js';
import {House,UserMinus,UserPlus,X} from 'lucide-react';

// Friends: my location for friends, the people, then Add friend. Invitations and
// managing friends open only when asked for.
//
// `locations` maps a friend's user id to their location state (from the friend
// location rows). A friend without a row has no recent position; that is never
// shown as "sharing off", because this viewer cannot know it. `self.state` is
// what friends actually received from you (live, stale or waiting), never just
// the sharing setting.
export default function Friends({personPhotos={},selfId=null,selfAvatar=null,self=null,onHouseholdJoined=null,household=[],householdLocations={},sharing=null,permission,precise,locations={},onShowPerson=null,onSetHome=null,hasHome=false,onShareLive,invitationCode=null,onInviteConsumed}){
 const [inviteAccepted,setInviteAccepted]=useState(false),[shareBusy,setShareBusy]=useState(false),[shareError,setShareError]=useState('');
 const [friends,setFriends]=useState([]),[code,setCode]=useState(''),[error,setError]=useState(''),[feedback,setFeedback]=useState(''),[busy,setBusy]=useState(false);
 const [adding,setAdding]=useState(Boolean(invitationCode));
 const rpc=useCallback(async(name,params)=>{if(!supabase)throw Error('Connect to manage friends.');const {data,error:e}=await supabase.rpc(name,params);if(e)throw Error(e.message||'Friend request failed.');return data;},[]);
 const refresh=useCallback(async()=>{try{setFriends(await rpc('my_friends')||[]);}catch(e){setError(e.message);}},[rpc]);
 useEffect(()=>{const t=setTimeout(()=>void refresh(),0);return()=>clearTimeout(t);},[refresh]);
 useEffect(()=>{if(invitationCode)queueMicrotask(()=>{setCode(invitationCode);setAdding(true);});},[invitationCode]);
 async function action(fn){setBusy(true);setError('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}}
 const closeAdding=()=>{setAdding(false);setPreview(null);};
 // Joining a household shares location, so the person sees that before accepting.
 const [preview,setPreview]=useState(null);
 async function accept(){await rpc('accept_friend_invite',{p_token:code.trim()});const joined=preview?.can_join;setCode('');setPreview(null);await refresh();setAdding(false);setInviteAccepted(true);onInviteConsumed?.();if(joined)onHouseholdJoined?.();}
 async function review(){
  // Before the backend update this call does not exist: accept as a plain friend invitation.
  const found=await rpc('friend_invite_preview',{p_token:code.trim()}).catch(()=>null);
  const details=Array.isArray(found)?found[0]:null;
  if(details?.household_name){setPreview(details);return;}
  await accept();
 }
 // Everyone you are connected to, once: you are not in your own list.
 const everyone=connectedPeople({friends,household,selfID:selfId});
 const people=everyone.map(person=>{
  const location=person.household?householdLocations[person.id]||null:locations[person.id]||null;
  return {id:person.id,userId:person.id,name:person.name,role:person.household?'Household':null,status:personStatus(location||{state:'unknown'}),onSelect:location?.position&&onShowPerson?()=>onShowPerson(location.position,person.id):null};
 });
 return <section className="social-screen social-friends" aria-label="Friends">
  {sharing&&<LocationSharingRow audience="friends" enabled={sharing.enabled} ready={sharing.ready!==false} error={sharing.error} onChange={sharing.onChange} permission={permission} precise={precise}/>}
  {sharing?.enabled&&<p className="social-hint">Your location: {selfStatus({enabled:true,state:self?.state,ageSeconds:self?.ageSeconds,home:self?.home,activity:self?.activity,permission,precise}).text}</p>}
  <div className="social-heading"><h2>Friends</h2>{people.length>0&&<span className="social-count">{people.length}</span>}</div>
  <PeopleGrid people={people} photos={personPhotos} selfId={selfId} selfAvatar={selfAvatar} label="Friends"/>
  {!people.length&&<p className="social-empty">No friends yet. Add someone to see each other on the map.</p>}
  <SocialActions label="Friend actions" actions={[{id:'add',label:'Add friend',icon:UserPlus,onClick:()=>setAdding(true),expanded:adding},onSetHome&&{id:'home',label:hasHome?'Home':'Set Home',icon:House,onClick:onSetHome}]}/>
  {inviteAccepted&&<InviteSharingPrompt kind="friend" busy={shareBusy} error={shareError} onClose={()=>{setInviteAccepted(false);setShareError('');}} onEnable={async()=>{setShareBusy(true);setShareError('');try{if(!onShareLive)throw new Error('Location sharing is unavailable.');await onShareLive();setInviteAccepted(false);setFeedback('Live location sharing is on.');}catch(e){setShareError(e.message||'Could not enable sharing.');}finally{setShareBusy(false);}}}/>}
  {feedback&&!adding&&<p role="status" className="notice">{feedback}</p>}
  {error&&!adding&&<p role="alert" className="error">{error}</p>}
  {adding&&<div className="modal-backdrop" onClick={closeAdding}><DismissibleSheet label="Add friend" onClose={closeAdding}>
   <div className="social-sheet-head"><h2>Add friend</h2><button type="button" className="icon-button" aria-label="Close" onClick={closeAdding}><X size={20}/></button></div>
   <InviteComposer busy={busy} create={()=>rpc('create_friend_invite')}/>
   {preview?<div className="notice" role="status"><strong>{preview.invited_by_name} invited you to {preview.household_name}</strong>
    <p className="small-copy">{preview.can_join?'You will be friends and join this household. Household members can see each other on the map once they turn on location sharing.':'You are already in a household, so you will be added as a friend only.'}</p>
    <div className="detail-actions"><button type="button" className="secondary" disabled={busy} onClick={()=>setPreview(null)}>Cancel</button><button type="button" className="primary" disabled={busy} onClick={()=>action(accept)}>{preview.can_join?'Join':'Add friend'}</button></div>
   </div>:<form className="social-code-form" onSubmit={e=>{e.preventDefault();void action(review);}}>
    <label>Have an invitation code?<input value={code} onChange={e=>setCode(e.target.value)} required placeholder="Paste their code"/></label><button className="secondary full" disabled={busy}>Add friend</button>
   </form>}
   {friends.length>0&&<><h3 className="social-sheet-label">Your friends</h3><ul className="grouped-list social-manage-list">{friends.map(f=><li key={f.user_id} className="grouped-row"><span className="social-manage-person"><PersonAvatar name={f.display_name} userId={f.user_id} selfId={selfId} photos={personPhotos} selfAvatar={selfAvatar} size="sm"/>{f.display_name||'Friend'}</span><button type="button" className="icon-button social-remove" aria-label={`Remove friend ${f.display_name}`} disabled={busy} onClick={()=>action(async()=>{await rpc('remove_friend',{p_friend:f.user_id});await refresh();})}><UserMinus size={18}/></button></li>)}</ul></>}
   {feedback&&<p role="status" className="notice">{feedback}</p>}
   {error&&<p role="alert" className="error">{error}</p>}
  </DismissibleSheet></div>}
 </section>;
}
