import TeslaRecording from './TeslaRecording.jsx';
import {useEffect,useState} from 'react';
import {Car,Archive,Plus,ChevronRight,Trash2,Route} from 'lucide-react';
import {teslaRequest} from '../lib/tesla.js';
import CollectionItemEditor from './CollectionItemEditor.jsx';
import CollectionIcon from './CollectionIcon.jsx';
import PrivateImage from './PrivateImage.jsx';
import TeslaManagement from './TeslaManagement.jsx';
import {teslaConnected,teslaLocationLabel} from '../lib/teslaStatus.js';
import {itemCategory,itemDetail,itemTitle} from '../lib/collection.js';
const sourceLabel=item=>item.source==='tesla'?'Tesla import':item.source==='manual'?'Manual':'Saved item';
export default function Garage({vehicles,onSave,onViewTrips=()=>{},tripCounts={}}){
 const [view,setView]=useState('list'),[editing,setEditing]=useState(null),[saving,setSaving]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[removing,setRemoving]=useState(false),[status,setStatus]=useState(null),[statusLoading,setStatusLoading]=useState(true);
 const imported=vehicles.filter(v=>v.source==='tesla'),connected=teslaConnected(status);
 async function refresh(){const next=await teslaRequest('status');setStatus(next);return next;}
 useEffect(()=>{let alive=true;async function update(event){if(event?.detail?.status&&event.detail.status!=='connected')setMessage(event.detail.status==='cancelled'?'Tesla sign-in cancelled.':'Tesla connection did not finish. Open Manage Tesla to retry.');try{const next=await teslaRequest('status');if(alive)setStatus(next);}catch{if(alive)setStatus(null);}finally{if(alive)setStatusLoading(false);}}void update();window.addEventListener('letm3go:tesla-connected',update);return()=>{alive=false;window.removeEventListener('letm3go:tesla-connected',update);};},[]);
 async function persist(next){setSaving(true);setError('');try{await onSave(next);return true;}catch{setError('Collection changes could not be saved. Please retry.');return false;}finally{setSaving(false);}}
 async function saveItem(item){const next=editing?vehicles.map(v=>v.id===item.id?item:v):[...vehicles,item];if(await persist(next)){setMessage(editing?'Item updated.':'Item added to your Collection.');return true;}return false;}
 async function importVehicles(incoming){
  // Stable server IDs deduplicate repeated imports. Preserve the user's local edits.
  const next=[...vehicles];for(const v of incoming){const index=next.findIndex(existing=>existing.id===v.id||(v.teslaVehicleID&&existing.teslaVehicleID===v.teslaVehicleID));if(index>=0)next[index]={...v,...next[index],source:'tesla',teslaVehicleID:v.teslaVehicleID||next[index].teslaVehicleID};else next.push(v);}
  if(!await persist(next))throw new Error('Changes could not be saved to My Collection. Please retry.');
 }
 function back(){setView('list');setEditing(null);setError('');setRemoving(false);}
 if(view==='item')return <><CollectionItemEditor key={editing?.id||'new'} item={editing} saving={saving} error={error} onBack={back} onSave={saveItem}/>
  {editing?.id&&<section className="garage-view collection-item-actions">
   <h3>{itemTitle(editing)}</h3>
   <p className="muted small-copy">{[itemCategory(editing).label,itemDetail(editing)].filter(Boolean).join(' · ')}</p>
   {tripCounts[editing.id]>0?<button type="button" className="secondary full" onClick={()=>onViewTrips(editing)}><Route size={17}/> View {tripCounts[editing.id]} {tripCounts[editing.id]===1?'activity':'activities'}</button>:<p className="muted small-copy">No activities use this item yet.</p>}
   <div className="garage-detail-actions">
    <button type="button" className="secondary" disabled={saving} onClick={async()=>{if(await persist(vehicles.map(v=>v.id===editing.id?{...editing,archived:!editing.archived}:v))){setMessage(editing.archived?'Item restored.':'Item archived.');back();}}}><Archive size={16}/>{editing.archived?'Restore':'Archive'} {itemTitle(editing)}</button>
    <button type="button" className="text-button" disabled={saving} onClick={()=>setRemoving(true)}><Trash2 size={16}/> Remove {itemTitle(editing)}</button>
   </div>
   {removing&&<div className="notice"><p>Remove {itemTitle(editing)} from My Collection? Activities that already mention it keep their label. Your Tesla account stays connected.</p><div className="garage-detail-actions"><button type="button" className="secondary" disabled={saving} onClick={()=>setRemoving(false)}>Cancel removal</button><button type="button" className="primary" disabled={saving} onClick={async()=>{if(await persist(vehicles.filter(v=>v.id!==editing.id))){setMessage('Item removed.');back();}}}>Confirm removal</button></div></div>}
   {editing.source==='tesla'&&<TeslaRecording vehicle={editing}/>}
   {message&&<p role="status" className="notice">{message}</p>}
  </section>}</>;
 if(view==='tesla')return <TeslaManagement status={status} onStatus={setStatus} vehicles={vehicles} onImport={importVehicles} onBack={back} onRefresh={refresh}/>;
 return <section className="garage-view"><p className="eyebrow">YOUR COLLECTION</p><h2>My Collection</h2><p className="muted small-copy">Your cars, bikes and equipment, all in one place.</p>
 {vehicles.length?<div className="garage-vehicle-list">{[...vehicles].sort((a,b)=>Number(!!a.archived)-Number(!!b.archived)).map(v=>{
  return <button type="button" key={v.id} className="garage-vehicle-row" aria-label={`View ${itemTitle(v)}`} onClick={()=>{setEditing(v);setError('');setMessage('');setView('item');}}>
   {v.photo?<PrivateImage className="garage-vehicle-photo" src={v.photo} alt=""/>:<span className="overview-icon"><CollectionIcon icon={itemCategory(v).icon} size={20}/></span>}
   <span className="garage-vehicle-copy"><strong>{itemTitle(v)}</strong><small>{[[v.make,v.model].filter(Boolean).join(' '),itemDetail(v)].filter(Boolean).join(' · ')||'Collection item details'} · {sourceLabel(v)}{v.archived?' · Archived':''}</small>{v.source==='tesla'&&<TeslaRecording vehicle={v} compact/>}</span><ChevronRight size={17} aria-hidden="true"/></button>;
 })}</div>:<div className="garage-empty"><Car size={30}/><h3>Your collection is empty</h3><p>Add a bicycle, kite, car or other equipment.</p></div>}
 <button type="button" className="primary full" onClick={()=>{setEditing(null);setError('');setMessage('');setView('item');}}><Plus size={17}/> Add item</button>
 {vehicles.some(v=>v.archived)&&<p className="muted small-copy">{vehicles.filter(v=>v.archived).length} archived {vehicles.filter(v=>v.archived).length===1?'item stays':'items stay'} out of trip pickers.</p>}
 <section className="garage-tesla-summary" aria-labelledby="garage-tesla-title"><div className="section-heading"><h3 id="garage-tesla-title">Tesla</h3><span className="local-badge">{statusLoading?'Checking…':status?(connected?'Connected':'Not connected'):'Status unavailable'}</span></div><p className="small-copy">{imported.length} {imported.length===1?'vehicle':'vehicles'} imported · Location access: {teslaLocationLabel(status)}</p>{connected&&!imported.length&&<p className="muted small-copy">Connected. Choose Tesla vehicles to add them to My Collection.</p>}<button type="button" className="secondary full" onClick={()=>{setError('');setMessage('');setView('tesla');}}>{connected||!status&&!statusLoading?'Manage Tesla':'Connect Tesla'}<ChevronRight size={16}/></button></section>
 {message&&<p role="status" className="notice">{message}</p>}{error&&<p role="alert" className="error">{error}</p>}</section>;
}
