import {useState} from 'react';
import {Copy,MessageCircle,Share2,UserPlus} from 'lucide-react';
import {invitationMessage} from '../lib/invitationLink.js';

// The one invitation screen. Friends and Household both send a friend invitation;
// what it does when accepted is decided by which one created it.
export default function InviteComposer({create,busy=false,household=null}){
 const [invite,setInvite]=useState(''),[feedback,setFeedback]=useState(''),[error,setError]=useState(''),[working,setWorking]=useState(false);
 const text=invite?invitationMessage(invite,household):'';
 async function start(){setWorking(true);setError('');try{setInvite(await create());}catch(e){setError(e.message);}finally{setWorking(false);}}
 async function share(){setError('');setFeedback('');try{if(navigator.share){await navigator.share({title:'Add me on letm3go',text});}else{await navigator.clipboard.writeText(text);setFeedback('Invitation copied. Paste it into a message.');}}catch(e){if(e.name!=='AbortError')setError('Sharing is unavailable. Try Copy invitation instead.');}}
 async function copy(){setError('');try{await navigator.clipboard.writeText(text);setFeedback('Invitation copied. Paste it into a message.');}catch{setError('Could not copy automatically. Select the invitation code below to copy it.');}}
 return <>
  {!invite?<button type="button" className="primary full" disabled={busy||working} onClick={start}><UserPlus size={17}/> Create invitation</button>
  :<div className="friend-invite-actions"><p className="social-hint">Invitation ready · expires in 48 hours</p><button type="button" className="primary full" onClick={share}><Share2 size={17}/> Share invitation</button><div className="social-inline-actions"><button type="button" className="secondary" onClick={copy}><Copy size={16}/> Copy</button><a className="secondary friend-sms-link" href={`sms:&body=${encodeURIComponent(text)}`}><MessageCircle size={16}/> Message</a></div><details><summary>Show invitation code</summary><code className="friend-invite-code">{invite}</code></details></div>}
  {feedback&&<p role="status" className="notice">{feedback}</p>}
  {error&&<p role="alert" className="error">{error}</p>}
 </>;
}
