import {MapPin,CarFront,Footprints,Bike,Activity} from 'lucide-react';
const MotionIcon=({activity})=>activity==='Driving'?<CarFront size={18}/>:activity==='Walking'||activity==='Running'?<Footprints size={18}/>:activity==='Cycling'?<Bike size={18}/>:<Activity size={18}/>;
export default function HouseholdPresence({presence,places=[],onSetHome}){
 return <section className="social-panel household-presence">
 <div className="social-presence-top"><div><h2>Friends on the map</h2><p className="muted small-copy">See people who choose to share their location or activity with you. Locations must be recent.</p></div><span className="social-status-pill">{presence.liveEnabled?'Location sharing on':'Location sharing off'}</span></div>
 <div className="social-presence-bubbles">{presence.self?.sharing_enabled&&presence.self?.activity_label&&<div className="social-person"><span className="home-friends-avatar friend-moving"><MotionIcon activity={presence.self.activity_label}/></span><strong>You</strong><small><MapPin size={11}/>{presence.self.activity_label}</small></div>}{presence.people.map(p=><div key={p.user_id} className="social-person"><span className="home-friends-avatar"><MotionIcon activity={p.activity_label}/></span><strong>{p.display_name}</strong><small>{p.activity_label}{p.place_label?' · '+p.place_label:''}</small></div>)}</div>
 {!presence.people.length&&<p className="muted small-copy">No friends sharing a recent status yet. Add friends below to connect.</p>}
 <div className="social-location-actions"><button type="button" className="secondary" aria-pressed={presence.liveEnabled} onClick={async()=>{try{await presence.setLiveSharing(!presence.liveEnabled);}catch(e){window.alert(e.message||'Could not update sharing');}}}>{presence.liveEnabled?'Stop sharing location':'Share my location'}</button><button type="button" className="secondary" onClick={onSetHome}>{places.some(p=>p.kind==='home')?'Edit Home':'Set Home'}</button></div>
 <p className="muted small-copy">Your precise location is private until you choose to share it. The existing live-location service currently shares with household members, not all friends; friend-location sharing is not enabled yet.</p>
 {presence.liveError&&<p role="alert" className="error">{presence.liveError}</p>}{presence.error&&<p role="alert" className="error">{presence.error}</p>}
 </section>;
}
