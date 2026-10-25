import {useEffect,useState} from 'react';
import {supabase} from '../lib/supabase.js';
import {Users,UserPlus,UserMinus} from 'lucide-react';
export default function Friends(){
 const [friends,setFriends]=useState([]),[invite,setInvite]=useState(''),[code,setCode]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function rpc(name,params){if(!supabase)throw Error('Connect to manage friends.');const {data,error:e}=await supabase.rpc(name,params);if(e)throw Error(e.message||'Friend request failed.');return data;}
 async function refresh(){try{setFriends(await rpc('my_friends')||[]);}catch(e){setError(e.message);}}
 useEffect(()=>{const t=setTimeout(()=>void refresh(),0);return()=>clearTimeout(t);},[]);
 async function action(fn){setBusy(true);setError('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <section className="household-friends"><h2><Users size={19}/> Friends</h2>
 <p className="muted small-copy">Friends are separate from household members. Adding a friend never shares vehicles, routes or private history. Only an explicitly shared, unexpired status may appear in their feed.</p>
 {friends.map(f=><div key={f.user_id} className="home-friend-row"><span className="home-friends-avatar"><Users size={17}/></span><span><strong>{f.display_name}</strong></span><button type="button" className="icon-button" aria-label={`Remove friend ${f.display_name}`} disabled={busy} onClick={()=>action(async()=>{await rpc('remove_friend',{p_friend:f.user_id});await refresh();})}><UserMinus size={17}/></button></div>)}
 {!friends.length&&<p className="muted small-copy">No friends added yet.</p>}
 <button type="button" className="secondary full" disabled={busy} onClick={()=>action(async()=>setInvite(await rpc('create_friend_invite')))}><UserPlus size={16}/> Create friend invitation</button>
 {invite&&<p className="notice">Private invite code (48 hours): <code>{invite}</code></p>}
 <form onSubmit={e=>{e.preventDefault();void action(async()=>{await rpc('accept_friend_invite',{p_token:code.trim()});setCode('');await refresh();});}}>
  <label>Accept a friend's invite<input value={code} onChange={e=>setCode(e.target.value)} required placeholder="Paste their private code"/></label><button className="secondary full" disabled={busy}>Add friend</button>
 </form>
 {error&&<p role="alert" className="error">{error}</p>}
 </section>;
}
