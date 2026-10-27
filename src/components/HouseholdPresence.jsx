import PersonAvatar from './PersonAvatar.jsx';
import {MapPin,CarFront,Footprints,Bike,Activity} from 'lucide-react';
const MotionIcon=({activity})=>activity==='Driving'?<CarFront size={18}/>:activity==='Walking'||activity==='Running'?<Footprints size={18}/>:activity==='Cycling'?<Bike size={18}/>:<Activity size={18}/>;
export default function HouseholdPresence({presence,friendsLocation,places=[],onSetHome,selfAvatar=null,selfName='You'}){
 return <section className="social-panel household-presence">
 <div className="social-presence-top"><div><h2>Friends on the map</h2><p className="muted small-copy">See people who choose to share their location or activity with you. Locations must be recent.</p></div><span className="social-status-pill">{friendsLocation.enabled?'Sharing with friends':'Not sharing'}</span></div>
 <div className="social-presence-bubbles">{presence.self?.sharing_enabled&&presence.self?.activity_label&&<div className="social-person"><PersonAvatar name={selfName} src={selfAvatar} size="lg"/><strong>You</strong><small><MotionIcon activity={presence.self.activity_label}/>{presence.self.activity_label}</small></div>}{friendsLocation.people.map(p=><div key={p.user_id} className="social-person"><PersonAvatar name={p.display_name} size="lg"/><strong>{p.display_name}</strong><small>Updated {new Date(p.updated_at).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'})}</small></div>)}</div>
 {!friendsLocation.people.length&&<p className="muted small-copy">No friends sharing a recent status yet. Add friends below to connect.</p>}
 <div className="social-location-actions"><button type="button" className="secondary" aria-pressed={friendsLocation.enabled} onClick={async()=>{try{await friendsLocation.setSharing(!friendsLocation.enabled);}catch(e){window.alert(e.message||'Could not update sharing');}}}>{friendsLocation.enabled?'Stop sharing with friends':'Share location with friends'}</button><button type="button" className="secondary" onClick={onSetHome}>{places.some(p=>p.kind==='home')?'Edit Home':'Set Home'}</button></div>
 <p className="muted small-copy">Your precise location is private until you choose to share it. Only accepted friends can see a recent position. Sharing stops when you turn it off.</p>
 {friendsLocation.error&&<p role="alert" className="error">{friendsLocation.error}</p>}{presence.error&&<p role="alert" className="error">{presence.error}</p>}
 </section>;
}
