import TeslaRecording from './TeslaRecording.jsx';
import {useEffect,useState} from 'react';
import {Car,Bike,Plus,ChevronRight} from 'lucide-react';
import {teslaRequest} from '../lib/tesla.js';
import VehicleEditor from './VehicleEditor.jsx';
import TeslaManagement from './TeslaManagement.jsx';
import {teslaConnected,teslaLocationLabel} from '../lib/teslaStatus.js';
export default function Garage({vehicles,onSave}){
 const [view,setView]=useState('list'),[editing,setEditing]=useState(null),[saving,setSaving]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[status,setStatus]=useState(null),[statusLoading,setStatusLoading]=useState(true);
 const imported=vehicles.filter(v=>v.source==='tesla'),connected=teslaConnected(status);
 async function refresh(){const next=await teslaRequest('status');setStatus(next);return next;}
 useEffect(()=>{let alive=true;async function update(event){if(event?.detail?.status&&event.detail.status!=='connected')setMessage(event.detail.status==='cancelled'?'Tesla sign-in cancelled.':'Tesla connection did not finish. Open Manage Tesla to retry.');try{const next=await teslaRequest('status');if(alive)setStatus(next);}catch{if(alive)setStatus(null);}finally{if(alive)setStatusLoading(false);}}void update();window.addEventListener('letm3go:tesla-connected',update);return()=>{alive=false;window.removeEventListener('letm3go:tesla-connected',update);};},[]);
 async function persist(next){setSaving(true);setError('');try{await onSave(next);return true;}catch{setError('Gear changes could not be saved. Please retry.');return false;}finally{setSaving(false);}}
 async function saveVehicle(vehicle){if(!vehicle.name.trim()){setError('Enter a vehicle name.');return false;}const next=editing?vehicles.map(v=>v.id===vehicle.id?vehicle:v):[...vehicles,vehicle];if(await persist(next)){setMessage('Gear saved.');return true;}return false;}
 async function importVehicles(incoming){
  // Stable server IDs deduplicate repeated imports. Preserve the user's local edits.
  const next=[...vehicles];for(const v of incoming){const index=next.findIndex(existing=>existing.id===v.id||(v.teslaVehicleID&&existing.teslaVehicleID===v.teslaVehicleID));if(index>=0)next[index]={...v,...next[index],source:'tesla',teslaVehicleID:v.teslaVehicleID||next[index].teslaVehicleID};else next.push(v);}
  if(!await persist(next))throw new Error('Gear could not be saved to My gear. Please retry.');
 }
 function back(){setView('list');setEditing(null);setError('');}
 if(view==='vehicle')return <VehicleEditor key={editing?.id||'new'} vehicle={editing} saving={saving} error={error} onBack={back} onSave={saveVehicle} onRemove={async id=>{if(await persist(vehicles.filter(v=>v.id!==id))){setMessage('Gear removed.');return true;}return false;}}/>;
 if(view==='tesla')return <TeslaManagement status={status} onStatus={setStatus} vehicles={vehicles} onImport={importVehicles} onBack={back} onRefresh={refresh}/>;
 return <section className="garage-view"><p className="eyebrow">YOUR GEAR</p><h2>My gear</h2><p className="muted small-copy">Your cars, bikes and equipment, all in one place.</p>
 {vehicles.length?<div className="garage-vehicle-list">{[...vehicles].sort((a,b)=>Number(!!a.archived)-Number(!!b.archived)).map(v=>{const Icon=['bicycle','ebike'].includes(v.category)?Bike:Car;return <button type="button" key={v.id} className="garage-vehicle-row" aria-label={`View ${v.name}`} onClick={()=>{setEditing(v);setError('');setView('vehicle');}}><span className="overview-icon"><Icon size={20}/></span><span><strong>{v.name}</strong><small>{[v.make,v.model].filter(Boolean).join(' ')||'Gear details'} · {v.source==='tesla'?'Tesla import':v.source==='manual'?'Manual':'Saved vehicle'}{v.archived?' · Archived':''}</small>{v.source==='tesla'&&<TeslaRecording vehicle={v} compact/>}</span><ChevronRight size={17} aria-hidden="true"/></button>;})}</div>:<div className="garage-empty"><Car size={30}/><h3>No gear added yet</h3><p>Add a bicycle, e-bike, car or other gear.</p></div>}
 <button type="button" className="primary full" onClick={()=>{setEditing(null);setError('');setMessage('');setView('vehicle');}}><Plus size={17}/> Add gear</button>
 <section className="garage-tesla-summary" aria-labelledby="garage-tesla-title"><div className="section-heading"><h3 id="garage-tesla-title">Tesla</h3><span className="local-badge">{statusLoading?'Checking…':status?(connected?'Connected':'Not connected'):'Status unavailable'}</span></div><p className="small-copy">{imported.length} {imported.length===1?'vehicle':'vehicles'} imported · Location access: {teslaLocationLabel(status)}</p>{connected&&!imported.length&&<p className="muted small-copy">Connected. Choose Tesla vehicles to add them to My gear.</p>}<button type="button" className="secondary full" onClick={()=>{setError('');setMessage('');setView('tesla');}}>{connected||!status&&!statusLoading?'Manage Tesla':'Connect Tesla'}<ChevronRight size={16}/></button></section>
 {message&&<p role="status" className="notice">{message}</p>}{error&&<p role="alert" className="error">{error}</p>}</section>;
}
