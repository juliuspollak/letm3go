// A single mapping from recorder state to the record control's appearance, so the
// navigation and the record panel can never disagree about what is happening.
export const RECORD_CONTROL_STATES=['idle','starting','recording','paused','saving','auto'];

export function recordControlState(state={},busy=false){
 const active=state?.active||null;
 if(busy)return active?'saving':'starting';
 if(active)return active.state==='recording'?'recording':'paused';
 if(state?.automaticTrip||state?.automaticState==='recording')return 'auto';
 return 'idle';
}
