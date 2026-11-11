// Calendar days in a person's time zone, as epoch-second windows [start, end).
// Built on Intl so a daylight-saving day is 23 or 25 hours long, never 24 by
// assumption. Dates are 'YYYY-MM-DD' keys.
const parts=new Map();
function formatter(timeZone){
 if(!parts.has(timeZone))parts.set(timeZone,new Intl.DateTimeFormat('en-CA',{timeZone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}));
 return parts.get(timeZone);
}
function fields(seconds,timeZone){
 const out={};for(const p of formatter(timeZone).formatToParts(new Date(seconds*1000)))if(p.type!=='literal')out[p.type]=Number(p.value);
 return out;
}
// The day an instant falls on, in that zone.
export function dayKeyOf(seconds,timeZone){
 const f=fields(seconds,timeZone);
 return `${String(f.year).padStart(4,'0')}-${String(f.month).padStart(2,'0')}-${String(f.day).padStart(2,'0')}`;
}
export function addDays(key,days){
 const [y,m,d]=key.split('-').map(Number);
 return new Date(Date.UTC(y,m-1,d+days)).toISOString().slice(0,10);
}
// Offset (seconds) of the zone at an instant: local wall time minus UTC.
function offset(seconds,timeZone){
 const f=fields(seconds,timeZone);
 return Date.UTC(f.year,f.month-1,f.day,f.hour,f.minute,f.second)/1000-Math.floor(seconds);
}
// The first instant of a local date. A midnight skipped by a clock change starts the
// day at the first instant that exists on it.
export function dayStart(key,timeZone){
 const [y,m,d]=key.split('-').map(Number);
 const wall=Date.UTC(y,m-1,d)/1000;
 let guess=wall-offset(wall,timeZone);
 guess=wall-offset(guess,timeZone);
 // If the guess still lands on the previous local day (a skipped midnight), step forward.
 while(dayKeyOf(guess,timeZone)<key)guess+=60;
 while(dayKeyOf(guess-1,timeZone)>=key)guess-=60;
 return guess;
}
export function dayWindow(key,timeZone){
 return {key,start:dayStart(key,timeZone),end:dayStart(addDays(key,1),timeZone),timeZone};
}
