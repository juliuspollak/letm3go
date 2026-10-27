import PersonAvatar from './PersonAvatar.jsx';
import {useCallback,useEffect,useState} from 'react';
import {supabase} from '../lib/supabase.js';
import {Users,UserPlus,UserMinus,Share2,Copy,MessageCircle} from 'lucide-react';
export default function Friends(){
 const [friends,setFriends]=useState([]),[invite,setInvite]=useState(''),[code,setCode]=useState(''),[error,setError]=useState(''),[feedback,setFeedback]=useState(''),[busy,setBusy]=useState(false);
 const rpc=useCallback(async(name,params)=>{if(!supabase)throw Error('Connect to manage friends.');const {data,error:e}=await supabase.rpc(name,params);if(e)throw Error(e.message||'Friend request failed.');return data;},[]);
 const refresh=useCallback(async()=>{try{setFriends(await rpc('my_friends')||[]);}catch(e){setError(e.message);}},[rpc]);
 useEffect(()=>{const t=setTimeout(()=>void refresh(),0);return()=>clearTimeout(t);},[refresh]);
 const inviteText=invite?`Join me on letm3go! Open the app, go to Social → Friends, and paste this invitation code to add me:\n\n${invite}\n\nThis private invitation expires in 48 hours.`:'';
 async function shareInvite(){if(!invite)return;setError('');setFeedback('');try{if(navigator.share){await navigator.share({title:'Add me on letm3go',text:inviteText});}else{await navigator.clipboard.writeText(inviteText);setFeedback('Invitation copied. Paste it into a message.');}}catch(e){if(e.name!=='AbortError')setError('Sharing is unavailable. Try Copy invitation instead.');}}
 async function copyInvite(){if(!invite)return;setError('');try{await navigator.clipboard.writeText(inviteText);setFeedback('Invitation copied. Paste it into a message.');}catch{setError('Could not copy automatically. Select the invitation code below to copy it.');}}
 async function action(fn){setBusy(true);setError('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <section className="social-panel household-friends"><h2><Users size={19}/> Friends</h2>
 <p className="muted small-copy">Friends are separate from household members. Adding a friend never shares vehicles, routes or private history. Only an explicitly shared, unexpired status may appear in their feed.</p>
 {friends.map(f=><div key={f.user_id} className="home-friend-row"><PersonAvatar name={f.display_name}/><span><strong>{f.display_name}</strong></span><button type="button" className="icon-button" aria-label={`Remove friend ${f.display_name}`} disabled={busy} onClick={()=>action(async()=>{await rpc('remove_friend',{p_friend:f.user_id});await refresh();})}><UserMinus size={17}/></button></div>)}
 {!friends.length&&<p className="muted small-copy">No friends added yet.</p>}
 <button type="button" className="secondary full" disabled={busy} onClick={()=>action(async()=>setInvite(await rpc('create_friend_invite')))}><UserPlus size={16}/> Generate invitation</button>
 {invite&&<div className="friend-invite-actions"><p className="muted small-copy">Invite ready · expires in 48 hours. Send it by Messages, WhatsApp or another app.</p><button type="button" className="primary full" onClick={shareInvite}><Share2 size={17}/> Share invitation</button><button type="button" className="secondary full" onClick={copyInvite}><Copy size={16}/> Copy invitation</button><a className="secondary full friend-sms-link" href={`sms:&body=${encodeURIComponent(inviteText)}`}><MessageCircle size={16}/> Send via SMS</a><details><summary>Show invitation code</summary><code className="friend-invite-code">{invite}</code></details></div>}
 {feedback&&<p role="status" className="notice">{feedback}</p>}
 <form onSubmit={e=>{e.preventDefault();void action(async()=>{await rpc('accept_friend_invite',{p_token:code.trim()});setCode('');await refresh();});}}>
  <label>Have an invitation? Paste the code<input value={code} onChange={e=>setCode(e.target.value)} required placeholder="Paste their private code"/></label><button className="secondary full" disabled={busy}>Add friend</button>
 </form>
 {error&&<p role="alert" className="error">{error}</p>}
 </section>;
}
