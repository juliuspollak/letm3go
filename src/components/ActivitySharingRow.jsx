import {useEffect,useState} from 'react';
import Switch from './Switch.jsx';
import {supabase} from '../lib/supabase.js';
import HistorySharingRow from './HistorySharingRow.jsx';

// Household members' new activities are shared with the household by default, from
// the day they joined. This is the one place to stop that (and start it again). It
// is separate from sharing my live location, and never changes either that or an
// activity already shared or kept private.
export default function ActivitySharingRow({client=supabase}){
 const [state,setState]=useState({ready:false,enabled:false,pending:false,error:'',waiting:0});
 useEffect(()=>{
  if(!client)return undefined;
  let alive=true;
  client.rpc('my_auto_share').then(({data,error})=>{if(alive)setState(s=>({...s,ready:!error&&Boolean(data),enabled:Boolean(data?.enabled)}));}).catch(()=>{});
  // How many finished activities are still waiting to be shared (shown, never silent).
  client.rpc('my_auto_share_pending',{p_limit:25}).then(({data})=>{if(alive&&Array.isArray(data))setState(s=>({...s,waiting:data.length}));}).catch(()=>{});
  return()=>{alive=false;};
 },[client]);
 async function change(enabled){
  setState(s=>({...s,pending:true,error:''}));
  const {error}=await client.rpc('set_auto_share',{p_enabled:enabled});
  setState(s=>error?{...s,pending:false,error:'Could not change activity sharing. Try again.'}:{...s,pending:false,enabled});
 }
 if(!state.ready)return null;
 return <div className="sharing-row-wrap">
  <div className={`sharing-row${state.enabled?' is-on':''}`}>
   <div className="sharing-row-text"><span className="sharing-row-title">New activities</span>
    <span className="sharing-row-caption" aria-live="polite">{state.pending?'Updating…':state.enabled?`Shared with household automatically · you can make any one private${state.waiting?` · ${state.waiting} waiting to send, retried when you open the app`:''}`:'Not shared unless you choose'}</span></div>
   <Switch checked={state.enabled} pending={state.pending} label="Share new activities with my household" onChange={change}/>
  </div>
  <HistorySharingRow client={client} autoEnabled={state.enabled}/>
  {state.error&&<p role="alert" className="error sharing-row-error">{state.error}</p>}
 </div>;
}
