import {useId,useState} from 'react';
import {Bell,ChevronRight} from 'lucide-react';
import {loadRecent,notificationTarget} from '../lib/notifications.js';

// The notifications at the top of Profile: what is new, and earlier ones on
// request. It reads the same inbox as the badge, so it works whether or not iOS
// notifications are allowed. Opening one marks just that one read and goes to
// where it belongs (a segment, Feedback & Support, Home).
export default function NotificationList({items,onOpen,onRead}){
 const earlierID=useId();
 const [earlier,setEarlier]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const expanded=earlier!==null;
 async function toggleEarlier(){
  if(expanded){setEarlier(null);return;}
  setError('');
  setLoading(true);
  try{setEarlier(await loadRecent());}
  catch{setError('Earlier notifications could not be loaded.');}
  finally{setLoading(false);}
 }
 const open=item=>{
  void onRead(item.id);
  const target=notificationTarget(item.route);
  if(target)onOpen(target);
 };
 const unreadIDs=new Set(items.map(item=>item.id));
 const older=(earlier||[]).filter(item=>!unreadIDs.has(item.id));
 return <section className="notification-list" aria-label="Notifications">
  <h3><Bell size={16} aria-hidden="true"/> Notifications</h3>
  {!items.length&&<p className="muted small-copy">No new notifications.</p>}
  <ul>
   {items.map(item=><li key={item.id}><Row item={item} unread onOpen={open}/></li>)}
  </ul>
  <div id={earlierID} hidden={!expanded}>
   {older.length?<ul>{older.map(item=><li key={item.id}><Row item={item} onOpen={open}/></li>)}</ul>:<p className="muted small-copy">No earlier notifications.</p>}
  </div>
  <button type="button" className="text-button" aria-expanded={expanded} aria-controls={earlierID} disabled={loading} onClick={toggleEarlier}>{expanded?'Hide earlier':loading?'Loading earlier…':'Show earlier'}</button>
  {error&&<p role="alert" className="error">{error}</p>}
 </section>;
}
function Row({item,unread=false,onOpen}){
 return <button type="button" className={`notification-row${unread?' notification-row--unread':''}`} onClick={()=>onOpen(item)}>
  <span><strong>{item.title}</strong><small>{item.body}</small><small className="muted">{new Date(item.created_at).toLocaleString(undefined,{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'})}</small></span>
  {unread&&<span className="sr-only">New</span>}
  <ChevronRight size={16} aria-hidden="true"/>
 </button>;
}
