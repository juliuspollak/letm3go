import TeslaRecording from './TeslaRecording.jsx';
import {useState} from 'react';
import {ArrowLeft,Archive,Trash2} from 'lucide-react';
import SwipeBack from './SwipeBack.jsx';
export default function VehicleEditor({vehicle,onSave,onRemove,onBack,saving,error}){
 const [removing,setRemoving]=useState(false);
 async function submit(event){
  event.preventDefault();const form=new FormData(event.currentTarget);
  const next={...vehicle,id:vehicle?.id||crypto.randomUUID(),name:String(form.get('name')||'').trim(),make:String(form.get('make')||'').trim(),model:String(form.get('model')||'').trim(),category:form.get('category'),archived:vehicle?.archived||false,source:vehicle?vehicle.source:'manual'};
  if(await onSave(next))onBack();
 }
 return <SwipeBack onBack={()=>{if(!saving)onBack();}}><section className="garage-view"><button type="button" className="text-button" disabled={saving} onClick={onBack}><ArrowLeft size={17}/> My gear</button><h2>{vehicle?'Gear details':'Add gear'}</h2><p className="muted small-copy">{vehicle?.source==='tesla'?'Imported from Tesla. Changes here update your Garage only.':'Add a car, motorbike, e-bike, regular bicycle or other gear.'}</p>
 <form onSubmit={submit}><label>Vehicle name<input name="name" required maxLength={60} defaultValue={vehicle?.name} placeholder="The family car" disabled={saving}/></label><label>Make<input name="make" maxLength={60} defaultValue={vehicle?.make} placeholder="e.g. Kia" disabled={saving}/></label><label>Model<input name="model" maxLength={60} defaultValue={vehicle?.model} placeholder="e.g. EV6" disabled={saving}/></label><label>Category<select name="category" defaultValue={vehicle?.category||'car'} disabled={saving}>{[['car','Car'],['motorcycle','Motorcycle'],['bicycle','Bicycle (regular)'],['ebike','Electric bicycle'],['other','Other']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><button type="submit" className="primary full" disabled={saving}>{saving?'Saving…':vehicle?'Save gear':'Add gear'}</button></form>
 {vehicle&&<div className="garage-detail-actions"><button type="button" className="secondary" disabled={saving} onClick={async()=>{if(await onSave({...vehicle,archived:!vehicle.archived}))onBack();}}><Archive size={16}/>{vehicle.archived?'Restore':'Archive'} {vehicle.name}</button><button type="button" className="text-button" disabled={saving} onClick={()=>setRemoving(true)}><Trash2 size={16}/> Remove {vehicle.name}</button></div>}
 {removing&&<div className="notice"><p>Remove {vehicle.name} from My gear? Existing trip labels stay unchanged. Your Tesla account stays connected.</p><div className="garage-detail-actions"><button type="button" className="secondary" disabled={saving} onClick={()=>setRemoving(false)}>Cancel removal</button><button type="button" className="primary" disabled={saving} onClick={async()=>{if(await onRemove(vehicle.id))onBack();}}>Confirm removal</button></div></div>}
 {vehicle?.source==='tesla'&&<TeslaRecording vehicle={vehicle}/>}
 {error&&<p role="alert" className="error">{error}</p>}</section></SwipeBack>;
}
