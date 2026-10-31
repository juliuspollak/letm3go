// MTB remains the persisted/native identifier for compatibility with recordings,
// Watch transfers and backups. It has one user-facing name everywhere.
export const MOUNTAIN_BIKING='Mountain biking';
export function activityCode(activity){
 return typeof activity==='string'&&['mtb','mountain biking'].includes(activity.trim().toLowerCase())?'MTB':activity;
}
export const activityLabel=activity=>activityCode(activity)==='MTB'?MOUNTAIN_BIKING:activity;
export const sameActivity=(a,b)=>activityCode(a)===activityCode(b);
export const activityOptions=activities=>[...new Set(activities.map(activityCode))];
