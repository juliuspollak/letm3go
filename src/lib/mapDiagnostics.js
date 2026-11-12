// Counters for the native map lifecycle. The Activity Details performance claims
// in this repository are checked against these numbers rather than intuition:
// a scroll must not add embeds, and a sheet drag must add frames, not content
// re-applies. Nothing here changes behaviour; it only records it.
const counters=new Map();
const frames=[];

export const MAP_EVENTS=['embed','resize','update','snapshot','hide','unembed','frozen','scroll-ignored','render','overlay','heal','heal-gave-up'];

// The last layout the page and the native map agreed (or disagreed) on: numbers only, no positions of
// people, so it can be read from a device to see where the map really is.
let lastLayout=null;
export function recordMapLayout(layout){
 if(!mapDiagnosticsEnabled())return;
 lastLayout={...layout,at:Date.now()};
 publish();
}

// The global reader is installed only while the opt-in flag is set, so a release
// build does not expose map internals (or pay for them) unless diagnostics were
// explicitly turned on for a measurement.
const readers=new Map();
let nextReaderToken=0;
function publish(){
 if(typeof window==='undefined'||!mapDiagnosticsEnabled())return;
 window.__letm3goMapEvents=snapshot();
 window.letm3goMapDiagnostics=()=>{
  for(const read of readers.values())try{read();}catch{/* a detached map must not break the reader */}
  return window.__letm3goMapEvents=snapshot();
 };
}
// Registers one live map with the global reader. Each install owns a unique
// token, so overlapping maps are counted separately and the global is removed
// with the last live registration instead of being left pointing at nothing.
export function installMapDiagnostics(read){
 if(!mapDiagnosticsEnabled())return ()=>{};
 const token=nextReaderToken++;
 readers.set(token,read);publish();
 let released=false;
 return ()=>{
  if(released)return;
  released=true;
  readers.delete(token);
  if(typeof window!=='undefined'&&!readers.size){
   delete window.letm3goMapDiagnostics;
   delete window.__letm3goMapEvents;
  }
 };
}

export function recordMapEvent(event,detail){
 // Recording itself is opt-in: a normal build must not accumulate counters or
 // retain event details for a measurement nobody asked for.
 if(!mapDiagnosticsEnabled())return;
 const current=counters.get(event)||{count:0,lastAt:0,lastDetail:null};
 counters.set(event,{count:current.count+1,lastAt:Date.now(),lastDetail:detail??null});
 publish();
}
// Frame intervals are JS requestAnimationFrame intervals, not native frame
// times; snapshot() labels them kind:'js-rAF' so they are never reported as the
// latter. They are sampled around actual page scrolls and sheet/viewer
// transitions, not just the initial five-hundred-millisecond settle.
export function recordMapFrame(milliseconds){
 if(!mapDiagnosticsEnabled()||!Number.isFinite(milliseconds)||milliseconds<0)return;
 frames.push(Math.round(milliseconds*10)/10);
 while(frames.length>120)frames.shift();
}
export function snapshot(){
 const events={};
 for(const name of MAP_EVENTS)events[name]=counters.get(name)?.count||0;
 return {
  events,
  frames:{
   kind:'js-rAF',
   count:frames.length,
   worst:frames.length?Math.max(...frames):0,
   average:frames.length?Math.round(frames.reduce((sum,n)=>sum+n,0)/frames.length*10)/10:0
  },
  layout:lastLayout,
  at:Date.now(),
 };
}
export function resetMapDiagnostics(){
 counters.clear();frames.length=0;readers.clear();lastLayout=null;
 if(typeof window!=='undefined'){delete window.__letm3goMapEvents;delete window.letm3goMapDiagnostics;}
}
// The diagnostics are opt-in and read-only; the UI and the performance notes use
// the same numbers.
export function mapDiagnosticsEnabled(){
 try{return typeof localStorage!=='undefined'&&localStorage.getItem('letm3go-map-diagnostics')==='1';}catch{return false;}
}
