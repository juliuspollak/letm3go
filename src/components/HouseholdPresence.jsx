import PersonBubble from './PersonBubble.jsx';
import LocationSharingControl from './LocationSharingControl.jsx';
import {CarFront,Footprints,Bike,Activity} from 'lucide-react';
const MotionIcon=({activity})=>activity==='Driving'?<CarFront size={18}/>:activity==='Walking'||activity==='Running'?<Footprints size={18}/>:activity==='Cycling'?<Bike size={18}/>:<Activity size={18}/>;
export default function HouseholdPresence({personPhotos={},presence,friendsLocation,householdLivePeople=[],householdLiveEnabled=false,places=[],onSetHome,selfAvatar=null,selfName='You',permission,precise}){
 const sharing=Boolean(friendsLocation.enabled||householdLiveEnabled);
 const selfStatus=householdLiveEnabled&&presence.self?.sharing_enabled&&presence.self?.activity_label?<><MotionIcon activity={presence.self.activity_label}/>{presence.self.activity_label}</>:sharing?'Live sharing on':'Live location off';
 return <section className="social-panel household-presence">
 <div className="social-presence-top"><div><h2>People on the map</h2><p className="muted small-copy">Friends and household members who choose to share their live location with you.</p></div><span className="social-status-pill">{friendsLocation.enabled||householdLiveEnabled?'Live sharing on':'Live sharing off'}</span></div>
 <div className="people-bubbles"><PersonBubble name={selfName} label="You" src={selfAvatar} status={selfStatus}/>{friendsLocation.people.map(p=><PersonBubble key={p.user_id} name={p.display_name} src={personPhotos[p.user_id]} status={`Updated ${new Date(p.updated_at).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'})}`}/>)}{householdLivePeople.filter(p=>!friendsLocation.people.some(f=>f.user_id===p.user_id)).map(p=><PersonBubble key={p.user_id} name={p.display_name} src={personPhotos[p.user_id]} status="Household · live"/>)}</div>
 {!friendsLocation.people.length&&!householdLivePeople.length&&<p className="muted small-copy">Nobody else sharing live location yet. Connected people appear here when they opt in.</p>}
 <div className="social-location-actions"><LocationSharingControl audience="your friends" enabled={friendsLocation.enabled} onChange={friendsLocation.setSharing} error={friendsLocation.error} permission={permission} precise={precise}/><button type="button" className="secondary" onClick={onSetHome}>{places.some(p=>p.kind==='home')?'Edit Home':'Set Home'}</button></div>
 <p className="muted small-copy">Your precise location is private until you choose to share it. Only accepted friends can see a recent position. Sharing stops when you turn it off.</p>
 {friendsLocation.error&&<p role="alert" className="error">{friendsLocation.error}</p>}{presence.error&&<p role="alert" className="error">{presence.error}</p>}
 </section>;
}
