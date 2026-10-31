import {activityLabel} from '../lib/activityNames.js';
import {useState} from 'react';
import {Check,Plus,Trash2} from 'lucide-react';
import CollectionIcon from './CollectionIcon.jsx';
import CollectionItemEditor from './CollectionItemEditor.jsx';
import PrivateImage from './PrivateImage.jsx';
import {equipmentForActivity,itemCategory,itemDetail,itemTitle,tripEquipment} from '../lib/collection.js';

// A lightweight sheet, never a configuration screen: one tap assigns, one tap
// changes, and an explicit action removes. Kitesurfing may hold a kite and a
// board together; a car or bicycle is replaced rather than stacked.
export default function EquipmentSheet({trip,vehicles=[],onAssign,onAddItem,onClose,busy=false}){
 const [view,setView]=useState('list');
 const [selected,setSelected]=useState(()=>tripEquipment(trip,vehicles).map(ref=>ref.id));
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState('');
 const multi=trip?.activity==='Kitesurfing';
 const compatible=equipmentForActivity(vehicles,trip?.activity);
 const assigned=tripEquipment(trip,vehicles);
 const extras=assigned.map(ref=>ref.item).filter(item=>item&&!compatible.some(option=>String(option.id)===String(item.id)));
 const options=[...extras,...compatible];
 const working=busy||saving;

 async function save(ids,close=true){
  setSaving(true);setError('');
  const ok=await onAssign(ids);
  setSaving(false);
  if(!ok){setError('Equipment could not be saved. Please retry.');return;}
  if(close)onClose?.();
 }
 function pick(item){
  const id=String(item.id);
  if(!multi){setSelected([id]);void save([id]);return;}
  const next=selected.includes(id)?selected.filter(value=>value!==id):[...selected,id];
  setSelected(next);void save(next,false);
 }
 async function addItem(item){
  const ok=await onAddItem?.(item);
  if(ok)setView('list');
  return ok;
 }
 if(view==='new')return <CollectionItemEditor item={null} onSave={addItem} onBack={()=>setView('list')} saving={false} error=""/>;

 return <section className="equipment-sheet">
  <p className="eyebrow">EQUIPMENT</p>
  <h2>{multi?'What did you use?':'What did you use it with?'}</h2>
  <p className="muted small-copy">{trip?.title}{trip?.activity?` · ${activityLabel(trip.activity)}`:''}</p>
  {options.length?<div className="equipment-options">
   {options.map(item=><button key={item.id} type="button" className="equipment-option" aria-pressed={selected.includes(String(item.id))} aria-label={`${multi?'Toggle':'Use'} ${itemTitle(item)}`} disabled={working} onClick={()=>pick(item)}>
    {item.photo?<PrivateImage className="equipment-option-photo" src={item.photo} alt=""/>:<span className="equipment-option-icon"><CollectionIcon icon={itemCategory(item).icon} size={20}/></span>}
    <span className="equipment-option-copy"><strong>{itemTitle(item)}</strong><small>{[itemDetail(item),itemCategory(item).label].filter(Boolean).join(' · ')}</small>{item.archived&&<small className="equipment-option-flag">Archived</small>}</span>
    {selected.includes(String(item.id))&&<Check size={19} aria-hidden="true"/>}
   </button>)}
  </div>:<div className="equipment-empty"><span className="equipment-option-icon"><CollectionIcon icon={itemCategory({category:'other'}).icon} size={20}/></span><p>{trip?.activity==='Kitesurfing'?'Add your kite or board to choose it here.':'Add this kind of equipment to your Collection to choose it here.'}</p></div>}
  {error&&<p role="alert" className="error">{error}</p>}
  <div className="equipment-actions">
   {selected.length>0&&<button type="button" className="text-button" disabled={working} onClick={()=>{setSelected([]);void save([]);}}><Trash2 size={16}/> Remove from this activity</button>}
   <button type="button" className="secondary full" disabled={working} onClick={()=>setView('new')}><Plus size={17}/> Add to Collection</button>
  </div>
  {multi&&<p className="muted small-copy">Tap a kite and a board to use both. Tapping again removes it.</p>}
 </section>;
}
