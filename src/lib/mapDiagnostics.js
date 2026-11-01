// Counters for the native map lifecycle. The Activity Details performance claims
// in this repository are checked against these numbers rather than intuition:
// a scroll must not add embeds, and a sheet drag must add frames, not content
// re-applies. Nothing here changes behaviour; it only records it.
const counters=new Map();
const frames=[];

export const MAP_EVENTS=['embed','resize','update','snapshot','hide','unembed','frozen','scroll-ignored'];

export function recordMapEvent(event,detail){
 const current=counters.get(event)||{count:0,lastAt:0,lastDetail:null};
 counters.set(event,{count:current.count+1,lastAt:Date.now(),lastDetail:detail??null});
 if(typeof window!=='undefined')window.__letm3goMapEvents=snapshot();
}
// Frame durations for the sheet drag, in milliseconds. Bounded so a long session
// cannot grow the buffer without limit.
export function recordMapFrame(milliseconds){
 if(!Number.isFinite(milliseconds)||milliseconds<0)return;
 frames.push(Math.round(milliseconds*10)/10);
 while(frames.length>120)frames.shift();
}
export function snapshot(){
 const events={};
 for(const name of MAP_EVENTS)events[name]=counters.get(name)?.count||0;
 return {
  events,
  frames:{count:frames.length,worst:frames.length?Math.max(...frames):0,average:frames.length?Math.round(frames.reduce((sum,n)=>sum+n,0)/frames.length*10)/10:0},
  at:Date.now(),
 };
}
export function resetMapDiagnostics(){
 counters.clear();frames.length=0;
 if(typeof window!=='undefined')delete window.__letm3goMapEvents;
}
// The diagnostics are opt-in and read-only; the UI and the performance notes use
// the same numbers.
export function mapDiagnosticsEnabled(){
 try{return typeof localStorage!=='undefined'&&localStorage.getItem('letm3go-map-diagnostics')==='1';}catch{return false;}
}
