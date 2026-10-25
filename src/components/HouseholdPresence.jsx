import {useState} from 'react';
import {EyeOff,MapPin,Users} from 'lucide-react';
const choices=['At home','At work','Shopping','At the beach','Outdoors','On the move','Other'];
export default function HouseholdPresence({presence}){
 const [activity,setActivity]=useState('At home'),[place,setPlace]=useState(''),[error,setError]=useState('');
 async function submit(event){event.preventDefault();setError('');try{await presence.update(true,activity,place.trim()||null);}catch(e){setError(e.message);}}
 return <section className="social-panel household-presence">
 <h2>Shared status</h2><p className="muted small-copy">Only your accepted friends and household members can see an actively shared status. It expires after 30 minutes. No GPS coordinates are uploaded.</p>
 {presence.error&&<p role="alert" className="error">{presence.error}</p>}
 {presence.people.map(p=><div key={p.user_id} className="home-friend-row"><span className={`home-friends-avatar ${p.activity_label==="On the move"?"friend-moving":""}`}><Users size={18}/></span><span><strong>{p.display_name}</strong><small><MapPin size={12}/> {p.activity_label}{p.place_label?' · '+p.place_label:''}</small><small>Updated {new Date(p.updated_at).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'})}</small></span></div>)}
 {!presence.people.length&&<p className="muted small-copy">No friends or household members are sharing a recent status.</p>}
 <h3>Your status</h3><p className="small-copy">{presence.self?.sharing_enabled?'Sharing enabled':'Hidden'}</p>
 {!presence.self?.sharing_enabled?<p className="muted small-copy"><EyeOff size={15}/> Use the eye icon beside your profile to enable sharing.</p>:<form onSubmit={submit}>
 <label>Status<select aria-label="Choose social status" value={activity} onChange={e=>setActivity(e.target.value)}>{choices.map(c=><option key={c}>{c}</option>)}</select></label>
 <label>Optional broad place or area<input value={place} onChange={e=>setPlace(e.target.value)} maxLength={60} placeholder="e.g. Bondi Beach"/></label>
 <button type="submit" className="primary" disabled={presence.busy}>Share for 30 minutes</button>
 </form>}
 {error&&<p role="alert" className="error">{error}</p>}
 </section>;
}
