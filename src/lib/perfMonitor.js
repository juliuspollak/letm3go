// Lightweight on-device performance record, included in feedback diagnostics when the person opts in. It exists so
// a slow session can be explained with numbers: how long the JS thread was blocked, which screen change or React
// commit took long, and how long the native recorder took to answer. It records durations and screen names only.
const LIMIT=60,TICK=200,BLOCKED=250,SLOW_COMMIT=80,SLOW_CALL=250,SLOW_SPAN=120;
const state={started:false,screen:'',events:[],blocked:0,worstBlockedMs:0,worstCommitMs:0,worstCallMs:0,commits:0,since:0,renders:0,worstRenderMs:0,spans:{},spanMs:{}};
const note=(kind,ms,extra={})=>{
 // Streamed to the native console too, so a cable-connected Mac sees a freeze as it happens (devicectl --console).
 try{console.log('[perf] '+JSON.stringify({kind,ms:Math.round(ms),screen:state.screen,...extra}));}catch{/* console unavailable */}
 state.events.push({t:Math.round((Date.now()-state.since)/1000),kind,ms:Math.round(ms),screen:state.screen,...extra});
 if(state.events.length>LIMIT)state.events.shift();
};
export function startPerfMonitor(){
 if(state.started||typeof window==='undefined')return;
 state.started=true;state.since=Date.now();
 let expected=performance.now()+TICK;
 // A resume from the background restarts the clock: iOS freezes timers there, which is not the app blocking.
 document.addEventListener('visibilitychange',()=>{expected=performance.now()+TICK;});
 setInterval(()=>{
  const now=performance.now(),lag=now-expected;expected=now+TICK;
  // A page in the background is not scheduled at all; ignore those gaps.
  if(document.visibilityState==='hidden'||lag>60000)return;
  if(lag>=BLOCKED){state.blocked+=1;state.worstBlockedMs=Math.max(state.worstBlockedMs,lag);note('js-blocked',lag);}
 },TICK);
}
export const perfScreen=name=>{state.screen=String(name||'');};
// React <Profiler onRender>: a commit that took long, and which phase.
export function perfCommit(id,phase,actualDuration){
 state.commits+=1;state.worstCommitMs=Math.max(state.worstCommitMs,actualDuration);
 if(actualDuration>=SLOW_COMMIT)note('slow-render',actualDuration,{phase,id});
}
// Time from a tap to the next painted frame.
export function perfTap(name){
 const start=performance.now();
 requestAnimationFrame(()=>requestAnimationFrame(()=>{const ms=performance.now()-start;if(ms>=150)note('slow-tap',ms,{tap:name});}));
}
// A native call that answered slowly (the recorder state poll, for example).
export function perfCall(name,startedAt,extra){
 const ms=performance.now()-startedAt;state.worstCallMs=Math.max(state.worstCallMs,ms);
 if(ms>=SLOW_CALL)note('slow-native-call',ms,{call:name,...extra});
}
// Times a stretch of work. `end(extra)` records it when it took long. Synchronous work measures CPU on the JS thread;
// across an await it measures elapsed time.
export function perfSpan(label){
 const start=performance.now();
 return extra=>{const ms=performance.now()-start;state.spans[label]=(state.spans[label]||0)+1;state.spanMs[label]=Math.max(state.spanMs[label]||0,ms);if(ms>=SLOW_SPAN)note('slow-work',ms,{work:label,...extra});};
}
export function perfRender(ms){
 state.renders+=1;state.worstRenderMs=Math.max(state.worstRenderMs,ms);
 if(ms>=100)note('slow-app-render',ms);
}
// Which of a computation's inputs changed since it last ran ('first' the first time): names only.
const lastInputs={};
// Weak references for objects: remembering the previous inputs must not keep large arrays alive after React dropped them.
const hold=value=>value!==null&&typeof value==='object'?new WeakRef(value):value;
const same=(held,value)=>(held instanceof WeakRef?held.deref():held)===value;
export function perfChanged(label,values,names){
 const before=lastInputs[label];lastInputs[label]=values.map(hold);
 return before?names.filter((_,i)=>!same(before[i],values[i])).join(','):'first';
}
export function perfSnapshot(){
 return {minutes:Math.round((Date.now()-state.since)/60000),jsBlocked:state.blocked,worstJsBlockedMs:Math.round(state.worstBlockedMs),
  appRenders:state.renders,worstAppRenderMs:Math.round(state.worstRenderMs),workCounts:state.spans,worstWorkMs:Object.fromEntries(Object.entries(state.spanMs).map(([k,v])=>[k,Math.round(v)])),worstNativeCallMs:Math.round(state.worstCallMs),recent:state.events.slice(-15)};
}
