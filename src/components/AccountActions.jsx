import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LogOut, Trash2 } from 'lucide-react';
import { useAuth } from '../lib/AuthContext.jsx';
export default function AccountActions({disabled=false}){
 const auth=useAuth(),[action,setAction]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const confirmation=useRef(null),returnFocus=useRef(null),titleID=useId(),descriptionID=useId();
 useEffect(()=>{
  if(!action)return;
  const previous=returnFocus.current||document.activeElement,page=document.getElementById('root');
  const priorInert=page?.getAttribute('inert'),priorOverflow=document.body.style.overflow;
  const ownsScrollLock=priorOverflow!=='hidden';
  page?.setAttribute('inert','');if(ownsScrollLock)document.body.style.overflow='hidden';
  confirmation.current?.querySelector('button')?.focus({preventScroll:true});
  return()=>{
   if(page){if(priorInert==null)page.removeAttribute('inert');else page.setAttribute('inert',priorInert);}
   if(ownsScrollLock)document.body.style.overflow=priorOverflow;
   if(previous?.isConnected)previous.focus({preventScroll:true});
  };
 },[action]);
 function open(next,trigger){returnFocus.current=trigger;setError('');setAction(next);}
 async function perform(){setBusy(true);setError('');try{if(action==='logout')await auth.signOut();else await auth.deleteAccount();}catch(err){setError(err.message||'This action could not be completed. Please retry.');}finally{setBusy(false);}}
 function keydown(event){
  // Keep the enclosing settings sheet's document-level handler from closing it
  // or trapping focus behind this portal while the confirmation is open.
  event.stopPropagation();
  if(event.key==='Escape'){event.preventDefault();if(!busy)setAction(null);}
  if(event.key==='Tab'){
   const controls=[...confirmation.current.querySelectorAll('button:not(:disabled),input:not(:disabled)')];
   const first=controls[0],last=controls.at(-1);
   if(!first){event.preventDefault();return;}
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
 }
 const popup=action&&createPortal(<div className="account-action-backdrop" onKeyDown={keydown} onClick={event=>{event.stopPropagation();if(event.target===event.currentTarget&&!busy)setAction(null);}}>
  <section ref={confirmation} className="account-action-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleID} aria-describedby={descriptionID} aria-busy={busy}>
   <h3 id={titleID}>{action==='logout'?'Sign out?':'Delete your account?'}</h3>
   <p id={descriptionID}>{action==='logout'?'Tracking will stop on this iPhone. Your journeys and photos stay encrypted and return when you sign in again. Your Tesla connection is retained.':'This permanently removes your cloud account and owned data, then this account’s encrypted local data. Connected services must be revoked first, and recent online authentication is required.'}</p>
   <form onSubmit={event=>{event.preventDefault();void perform();}}>
    {action==='delete'&&auth.accountDeletionNotice&&<p className="notice">{auth.accountDeletionNotice}</p>}
    {action==='delete'&&<label>Type DELETE to confirm<input name="confirmation" required pattern="DELETE" autoComplete="off" disabled={busy}/></label>}
    <div className="account-action-buttons"><button type="button" className="secondary" disabled={busy} onClick={()=>setAction(null)}>Cancel</button><button className="primary" disabled={busy||(action==='delete'&&auth.status==='offline')}>{busy?(action==='logout'?'Signing out…':'Deleting…'):(action==='logout'?'Sign out':'Delete account')}</button></div>
   </form>
   {busy&&<p role="status">{action==='logout'?'Stopping tracking and signing out…':'Deleting your account…'}</p>}
   {error&&<p role="alert" className="error">{error}</p>}
  </section>
 </div>,document.body);
 return <section aria-label="Account actions"><button className="secondary full" disabled={disabled||busy} onClick={event=>open('logout',event.currentTarget)}><LogOut size={17}/> Sign out</button><button className="text-button delete-activity" disabled={disabled||busy} onClick={event=>open('delete',event.currentTarget)}><Trash2 size={16}/> Delete account</button>{popup}</section>;
}
