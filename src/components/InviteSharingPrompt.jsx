import {MapPin,ShieldCheck} from 'lucide-react';

// Shown only after an invitation has been accepted. Membership never grants GPS consent.
export default function InviteSharingPrompt({kind='friend',onEnable,onClose,busy=false,error=''}) {
 return <section className="invite-sharing" role="dialog" aria-label="Choose live location sharing">
  <span className="invite-sharing-icon"><MapPin size={27}/></span>
  <h3>You're connected!</h3>
  <p>{kind==='household'?'Your household can now see you as a member.':'You're now connected as friends.'}</p>
  <h4>Share your live location?</h4>
  <p className="muted small-copy">Let connected people see where you are on the map. You can stop sharing at any time. Your previous trips remain private.</p>
  <button type="button" className="primary full" disabled={busy} onClick={onEnable}>{busy?'Enabling…':'Share live location'}</button>
  <button type="button" className="secondary full" disabled={busy} onClick={onClose}>Not now</button>
  <small><ShieldCheck size={14}/> Location sharing is off until you choose it.</small>
  {error&&<p role="alert" className="error">{error}</p>}
 </section>;
}
