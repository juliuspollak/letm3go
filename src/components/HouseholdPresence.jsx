import {EyeOff,MapPin,Users} from 'lucide-react';
export default function HouseholdPresence({presence}){
 return <section className="social-panel household-presence">
 <h2>Friends & family</h2><p className="muted small-copy">People appear here when they choose to be visible and letm3go has a recent activity to share. Driving and other recordings can update automatically while the app is running. No GPS coordinates or private routes are shared.</p>
 {presence.error&&<p role="alert" className="error">{presence.error}</p>}
 <div className="social-presence-bubbles">{presence.people.map(p=><div key={p.user_id} className="social-person"><span className={`home-friends-avatar ${p.activity_label==='On the move'?'friend-moving':''}`}><Users size={20}/></span><strong>{p.display_name}</strong><small><MapPin size={11}/>{p.activity_label}{p.place_label?' · '+p.place_label:''}</small></div>)}</div>
 {!presence.people.length&&<p className="muted small-copy">No friends or household members have a recent shared activity.</p>}
 <div className="social-visibility-caption"><strong>{presence.self?.sharing_enabled?'Visible to friends':'Hidden'}</strong><p className="muted small-copy">{presence.self?.sharing_enabled?'Activity updates automatically when recording is detected. Use the eye icon in the header to hide yourself.':'Use the eye icon in the header to enable automatic activity sharing.'}</p></div>
 {!presence.self?.sharing_enabled&&<p className="muted small-copy"><EyeOff size={15}/> Hidden by default. Your trips remain private.</p>}
 </section>;
}
