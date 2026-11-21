import {useEffect,useState} from 'react';
import Switch from './Switch.jsx';
import {supabase} from '../lib/supabase.js';
import {socialCache} from '../lib/socialCache.js';

// Household members' new activities are shared with the household by default, from
// the day they joined. This is the one place to stop that (and start it again). It
// is separate from sharing my live location, and never changes either that or an
// activity already shared or kept private.
export default function ActivitySharingRow({client=supabase,cacheKey=null}){
 // The row used to render nothing until its own request answered, so it appeared late and pushed everything below it down. Now the
 // last answer is shown at once (and refreshed quietly), and a first visit holds the row's place with a "Checking…" row of the same size.
 const key=cacheKey?'autoShare:'+cacheKey:null;
 const [state,setState]=useState(()=>{const known=key?socialCache.get(key)?.autoShare:null;return known?{ready:true,failed:false,enabled:known.enabled,pending:false,error:'',waiting:known.waiting||0}:{ready:false,failed:false,enabled:false,pending:false,error:'',waiting:0};});
 useEffect(()=>{
  if(!client)return undefined;
  let alive=true;
  client.rpc('my_auto_share').then(({data,error})=>{if(!alive)return;const ok=!error&&Boolean(data);if(ok&&key)socialCache.set(key,{autoShare:{...socialCache.get(key)?.autoShare,enabled:Boolean(data.enabled)}});setState(s=>({...s,ready:ok,failed:!ok,enabled:Boolean(data?.enabled)}));}).catch(()=>{if(alive)setState(s=>({...s,failed:true}));});
  // How many finished activities are still waiting to be shared (shown, never silent).
  client.rpc('my_auto_share_pending',{p_limit:25}).then(({data})=>{if(alive&&Array.isArray(data)){if(key)socialCache.set(key,{autoShare:{...socialCache.get(key)?.autoShare,waiting:data.length}});setState(s=>({...s,waiting:data.length}));}}).catch(()=>{});
  return()=>{alive=false;};
 },[client,key]);
 async function change(enabled){
  setState(s=>({...s,pending:true,error:''}));
  const {error}=await client.rpc('set_auto_share',{p_enabled:enabled});
  if(!error&&key)socialCache.set(key,{autoShare:{...socialCache.get(key)?.autoShare,enabled}});
  setState(s=>error?{...s,pending:false,error:'Could not change activity sharing. Try again.'}:{...s,pending:false,enabled});
 }
 if(state.failed&&!state.ready)return null;
 if(!state.ready){
  return <div className="sharing-row-wrap" aria-hidden="true"><div className="sharing-row">
   <div className="sharing-row-text"><span className="sharing-row-title">New activities</span><span className="sharing-row-caption">Checking…</span></div>
   <Switch checked={false} pending label="Share new activities with my household" onChange={()=>{}}/>
  </div></div>;
 }
 return <div className="sharing-row-wrap">
  <div className={`sharing-row${state.enabled?' is-on':''}`}>
   <div className="sharing-row-text"><span className="sharing-row-title">New activities</span>
    <span className="sharing-row-caption" aria-live="polite">{state.pending?'Updating…':state.enabled?`Shared with household automatically · you can make any one private${state.waiting?` · ${state.waiting} waiting to send, retried when you open the app`:''}`:'Not shared unless you choose'}</span></div>
   <Switch checked={state.enabled} pending={state.pending} label="Share new activities with my household" onChange={change}/>
  </div>
  {state.error&&<p role="alert" className="error sharing-row-error">{state.error}</p>}
 </div>;
}
