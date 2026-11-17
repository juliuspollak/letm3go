// Rope skipping is a subtype of Gym recorded on Apple Watch. The watch counts the jumps and
// sends one summary that is stored with the activity (details.ropeSkipping): it is a whole
// value that replaces the earlier one, never a running total, so a retry cannot double it.
export const ROPE_SKIPPING='Rope skipping';
const finite=Number.isFinite;
const MAX_JUMPS=100000,MAX_INTERVALS=200;

// The summary as the activity holds it, or null when there is none or it cannot be trusted.
export function ropeSummary(trip){
 if(trip?.activity!==ROPE_SKIPPING)return null;
 const r=trip?.details?.ropeSkipping;
 if(!r||!finite(r.jumps)||r.jumps<0||r.jumps>MAX_JUMPS||!finite(r.totalSeconds)||r.totalSeconds<0)return null;
 const total=r.totalSeconds,active=Math.min(total,Math.max(0,finite(r.activeSeconds)?r.activeSeconds:0));
 return {jumps:Math.round(r.jumps),totalSeconds:total,activeSeconds:active,restSeconds:total-active,
  intervalCount:Math.max(0,Math.round(finite(r.intervalCount)?r.intervalCount:0)),
  averageCadence:active>=1?r.jumps/active*60:0};
}

// 11:30, or 1:05:30 for an hour or more.
export function clockText(seconds){
 const total=Math.max(0,Math.round(finite(seconds)?seconds:0));
 const h=Math.floor(total/3600),m=Math.floor(total/60)%60,s=total%60;
 const pad=n=>String(n).padStart(2,'0');
 return h?`${h}:${pad(m)}:${pad(s)}`:`${m}:${pad(s)}`;
}
export const jumpsText=jumps=>Math.round(jumps).toLocaleString('en-AU');

// What the cloud keeps in the activity's view metadata: only the numbers, bounded, with at most
// MAX_INTERVALS intervals. Anything that does not look right is left out.
export function backupRope(value){
 if(!value||!finite(value.jumps)||value.jumps<0||value.jumps>MAX_JUMPS||!finite(value.totalSeconds)||value.totalSeconds<0||!finite(value.activeSeconds)||value.activeSeconds<0)return null;
 const intervals=(Array.isArray(value.intervals)?value.intervals:[]).filter(i=>i&&finite(i.start)&&finite(i.end)&&i.end>=i.start&&finite(i.jumps)&&i.jumps>0).slice(0,MAX_INTERVALS)
  .map(i=>({start:Math.round(i.start),end:Math.round(i.end),jumps:Math.round(i.jumps)}));
 return {jumps:Math.round(value.jumps),totalSeconds:Math.round(value.totalSeconds*10)/10,activeSeconds:Math.round(Math.min(value.activeSeconds,value.totalSeconds)*10)/10,
  intervalCount:Math.min(10000,Math.max(intervals.length,Math.round(finite(value.intervalCount)?value.intervalCount:0))),intervals};
}

// A picker lists the types a person can choose, plus the one the activity already has.
export const typesWithCurrent=(types,current)=>current&&!types.includes(current)?[...types,current]:types;
