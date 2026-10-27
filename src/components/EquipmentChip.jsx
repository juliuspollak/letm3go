import {Plus} from 'lucide-react';
import CollectionIcon from './CollectionIcon.jsx';
import {equipmentActionLabel,equipmentForActivity,isDerivedEquipment,itemCategory,tripEquipment} from '../lib/collection.js';

// Compact chip on a trip row. It appears only when the activity can use
// equipment the person owns, so an unrelated walk keeps its original row.
export function EquipmentChip({trip,items=[],onOpen,fallback=null}){
 const refs=tripEquipment(trip,items);
 if(refs.length){
  const primary=refs[0];
  const icon=primary.item?itemCategory(primary.item).icon:'other';
  const label=refs.length>1?`${primary.name} +${refs.length-1}`:primary.name;
  if(isDerivedEquipment(trip)||trip.isGroupedJourney)return <span className="trip-equipment-chip trip-equipment-chip--static" aria-label={`Vehicle: ${primary.name}`}>
   <CollectionIcon icon={icon} size={14}/><span>{label}</span>
  </span>;
  return <button type="button" className="trip-equipment-chip" aria-label={`Equipment: ${primary.name}. Change equipment`} onClick={()=>onOpen(trip)}>
   <CollectionIcon icon={icon} size={14}/><span>{label}</span>
  </button>;
 }
 if(isDerivedEquipment(trip)||trip.isGroupedJourney)return fallback;
 const action=equipmentActionLabel(trip.activity);
 if(!action||!equipmentForActivity(items,trip.activity).length)return fallback;
 return <button type="button" className="trip-equipment-chip trip-equipment-chip--empty" aria-label={`Add equipment to ${trip.title}`} onClick={()=>onOpen(trip)}>
  <Plus size={14} aria-hidden="true"/><span>{action}</span>
 </button>;
}

// Detail-screen control beside edit and privacy, never a separate screen.
export function EquipmentButton({trip,items=[],onOpen,disabled=false}){
 const refs=tripEquipment(trip,items);
 const compatible=equipmentForActivity(items,trip.activity);
 if(refs.length){
  const primary=refs[0];
  const icon=primary.item?itemCategory(primary.item).icon:'other';
  const label=refs.map(ref=>ref.name).join(' + ');
  if(isDerivedEquipment(trip)||trip.isGroupedJourney)return <span className="activity-equipment-button" aria-label={`Equipment: ${label}`}>
   <CollectionIcon icon={icon} size={16}/><span>{label}</span>
  </span>;
  return <button type="button" className="activity-equipment-button" aria-label={`Equipment: ${refs.map(ref=>ref.name).join(', ')}. Change equipment`} disabled={disabled} onClick={()=>onOpen(trip)}>
   <CollectionIcon icon={icon} size={16}/><span>{label}</span>
  </button>;
 }
 if(isDerivedEquipment(trip)||trip.isGroupedJourney)return null;
 const action=equipmentActionLabel(trip.activity);
 if(!action||!compatible.length)return null;
 return <button type="button" className="activity-equipment-button activity-equipment-button--empty" aria-label={action} disabled={disabled} onClick={()=>onOpen(trip)}>
  <CollectionIcon icon={itemCategory(compatible[0]).icon} size={16}/><span>{action}</span>
 </button>;
}
