import {invitationLink} from '../lib/invitationLink.js';
import InviteSharingPrompt from './InviteSharingPrompt.jsx';
import DismissibleSheet from './DismissibleSheet.jsx';
import LocationSharingRow from './LocationSharingRow.jsx';
import PeopleGrid from './PeopleGrid.jsx';
import PersonAvatar from './PersonAvatar.jsx';
import SocialActions from './SocialActions.jsx';
import {personStatus,selfStatus} from '../lib/personStatus.js';
import {useCallback,useEffect,useState} from 'react';
import {supabase} from '../lib/supabase.js';
import {Copy,House,MessageCircle,Share2,UserMinus,UserPlus,X} from 'lucide-react';

// Friends: my location for friends, the people, then Add friend. Invitations and
// managing friends open only when asked for.
//
// `locations` maps a friend's user id to their location state (from the friend
// location rows). A friend without a row has no recent position; that is never
// shown as "sharing off", because this viewer cannot know it.
export default function Friends({personPhotos={},selfId=null,selfAvatar=null,selfName='You',self=null,sharing=null,permission,precise,locations={},onShowPerson=null,onSetHome=null,hasHome=false,onShareLive,invitationCode=null,onInviteConsumed}){
 const [inviteAccepted,setInviteAccepted]=useState(false),[shareBusy,setShareBusy]=useState(false),[shareError,setShareError]=useState('');
 const [friends,setFriends]=useState([]),[invite,setInvite]=useState(''),[code,setCode]=useState(''),[error,setError]=useState(''),[feedback,setFeedback]=useState(''),[busy,setBusy]=useState(false);
 const [adding,setAdding]=useState(Boolean(invitationCode));
 const rpc=useCallback(async(name,params)=>{if(!supabase)throw Error('Connect to manage friends.');const {data,error:e}=await supabase.rpc(name,params);if(e)throw Error(e.message||'Friend request failed.');return data;},[]);
 const refresh=useCallback(async()=>{try{setFriends(await rpc('my_friends')||[]);}catch(e){setError(e.message);}},[rpc]);
 useEffect(()=>{const t=setTimeout(()=>void refresh(),0);return()=>clearTimeout(t);},[refresh]);
 useEffect(()=>{if(invitationCode)queueMicrotask(()=>{setCode(invitationCode);setAdding(true);});},[invitationCode]);
 const inviteText=invite?`Open my Letm3go invitation: ${invitationLink('friend',invite)}\n\nJoin me on letm3go! Open the app, go to Social → Friends, and paste this invitation code to add me:\n\n${invite}\n\nThis private invitation expires in 48 hours.`:'';
 async function shareInvite(){if(!invite)return;setError('');setFeedback('');try{if(navigator.share){await navigator.share({title:'Add me on letm3go',text:inviteText});}else{await navigator.clipboard.writeText(inviteText);setFeedback('Invitation copied. Paste it into a message.');}}catch(e){if(e.name!=='AbortError')setError('Sharing is unavailable. Try Copy invitation instead.');}}
 async function copyInvite(){if(!invite)return;setError('');try{await navigator.clipboard.writeText(inviteText);setFeedback('Invitation copied. Paste it into a message.');}catch{setError('Could not copy automatically. Select the invitation code below to copy it.');}}
 async function action(fn){setBusy(true);setError('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}}
 const closeAdding=()=>setAdding(false);
 const you={id:'self',userId:selfId,name:selfName,self:true,status:selfStatus({enabled:Boolean(sharing?.enabled),state:sharing?.error?'waiting':'live',home:self?.home,activity:self?.activity,permission,precise})};
 const people=[you,...friends.map(f=>{
  const location=locations[f.user_id]||null;
  return {id:f.user_id,userId:f.user_id,name:f.display_name,status:personStatus(location||{state:'unknown'}),onSelect:location?.position&&onShowPerson?()=>onShowPerson(location.position,f.user_id):null};
 })];
 return <section className="social-screen social-friends" aria-label="Friends">
  {sharing&&<LocationSharingRow audience="friends" enabled={sharing.enabled} ready={sharing.ready!==false} error={sharing.error} onChange={sharing.onChange} permission={permission} precise={precise}/>}
  <div className="social-heading"><h2>Friends</h2>{friends.length>0&&<span className="social-count">{friends.length}</span>}</div>
  <PeopleGrid people={people} photos={personPhotos} selfId={selfId} selfAvatar={selfAvatar} label="Friends"/>
  {!friends.length&&<p className="social-empty">No friends yet. Add someone to see each other on the map.</p>}
  <SocialActions label="Friend actions" actions={[{id:'add',label:'Add friend',icon:UserPlus,onClick:()=>setAdding(true),expanded:adding},onSetHome&&{id:'home',label:hasHome?'Home':'Set Home',icon:House,onClick:onSetHome}]}/>
  {inviteAccepted&&<InviteSharingPrompt kind="friend" busy={shareBusy} error={shareError} onClose={()=>{setInviteAccepted(false);setShareError('');}} onEnable={async()=>{setShareBusy(true);setShareError('');try{if(!onShareLive)throw new Error('Location sharing is unavailable.');await onShareLive();setInviteAccepted(false);setFeedback('Live location sharing is on.');}catch(e){setShareError(e.message||'Could not enable sharing.');}finally{setShareBusy(false);}}}/>}
  {feedback&&!adding&&<p role="status" className="notice">{feedback}</p>}
  {error&&!adding&&<p role="alert" className="error">{error}</p>}
  {adding&&<div className="modal-backdrop" onClick={closeAdding}><DismissibleSheet label="Add friend" onClose={closeAdding}>
   <div className="social-sheet-head"><h2>Add friend</h2><button type="button" className="icon-button" aria-label="Close" onClick={closeAdding}><X size={20}/></button></div>
   {!invite?<button type="button" className="primary full" disabled={busy} onClick={()=>action(async()=>setInvite(await rpc('create_friend_invite')))}><UserPlus size={17}/> Create invitation</button>
   :<div className="friend-invite-actions"><p className="social-hint">Invitation ready · expires in 48 hours</p><button type="button" className="primary full" onClick={shareInvite}><Share2 size={17}/> Share invitation</button><div className="social-inline-actions"><button type="button" className="secondary" onClick={copyInvite}><Copy size={16}/> Copy</button><a className="secondary friend-sms-link" href={`sms:&body=${encodeURIComponent(inviteText)}`}><MessageCircle size={16}/> Message</a></div><details><summary>Show invitation code</summary><code className="friend-invite-code">{invite}</code></details></div>}
   <form className="social-code-form" onSubmit={e=>{e.preventDefault();void action(async()=>{await rpc('accept_friend_invite',{p_token:code.trim()});setCode('');await refresh();setAdding(false);setInviteAccepted(true);onInviteConsumed?.();});}}>
    <label>Have an invitation code?<input value={code} onChange={e=>setCode(e.target.value)} required placeholder="Paste their code"/></label><button className="secondary full" disabled={busy}>Add friend</button>
   </form>
   {friends.length>0&&<><h3 className="social-sheet-label">Your friends</h3><ul className="grouped-list social-manage-list">{friends.map(f=><li key={f.user_id} className="grouped-row"><span className="social-manage-person"><PersonAvatar name={f.display_name} userId={f.user_id} selfId={selfId} photos={personPhotos} selfAvatar={selfAvatar} size="sm"/>{f.display_name||'Friend'}</span><button type="button" className="icon-button social-remove" aria-label={`Remove friend ${f.display_name}`} disabled={busy} onClick={()=>action(async()=>{await rpc('remove_friend',{p_friend:f.user_id});await refresh();})}><UserMinus size={18}/></button></li>)}</ul></>}
   {feedback&&<p role="status" className="notice">{feedback}</p>}
   {error&&<p role="alert" className="error">{error}</p>}
  </DismissibleSheet></div>}
 </section>;
}
