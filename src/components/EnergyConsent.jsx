import {heldEnergy} from '../lib/activitySummary.js';

// Measured energy from before the Watch knew whose body it measured. It is never
// shown or counted until the person answers; heart-rate acceptance does not answer
// this, and a rejection is persisted so a late update cannot bring it back.
export default function EnergyConsent({trip,busy,onResolve}){
 const held=heldEnergy(trip);
 if(!held)return null;
 return <div className="notice" role="status"><strong>Measured energy waiting for you</strong>
  <p>This was recorded before your Apple Watch knew which account to use. Add it only if you wore the Watch for this activity.</p>
  <div className="detail-actions"><button type="button" className="secondary" disabled={busy} onClick={()=>onResolve?.(false)}>Remove it</button><button type="button" className="primary" disabled={busy} onClick={()=>onResolve?.(true)}>This was me</button></div></div>;
}
