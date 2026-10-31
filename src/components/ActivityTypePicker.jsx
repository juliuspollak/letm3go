import {activityLabel,activityCode,sameActivity} from '../lib/activityNames.js';
import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { automaticTitle } from '../lib/activityTitle.js';
const types=['Walking','Running','Cycling','MTB','Road cycling','Driving','Kitesurfing','Hiking','Other','Unknown'];
export default function ActivityTypePicker({trip,run,onUpdated,busy}){
 const [saving,setSaving]=useState(false),[error,setError]=useState('');
 async function change(event){const activity=event.target.value;if(sameActivity(activity,trip.activity))return;setSaving(true);setError('');try{const result=await run('editActivity',{id:trip.id,activity,title:automaticTitle(trip)||trip.titleIsAutomatic?activity:trip.title,description:trip.description||'',notes:trip.notes||'',tags:trip.tags||[],collection:trip.collection||'',vehicle:trip.vehicle||undefined});const updated=result?.trips?.find(t=>t.id===trip.id);if(!updated)throw new Error();onUpdated(updated);}catch{setError('Activity type was not saved. Please retry.');}finally{setSaving(false);}}
 return <><label className="activity-type-picker"><span>{saving?'Saving…':activityLabel(trip.activity)}</span><Pencil size={14} aria-hidden="true"/><select aria-label="Change activity type" value={activityCode(trip.activity)} disabled={busy||saving} onChange={change}>{types.map(type=><option key={type} value={type}>{activityLabel(type)}</option>)}</select></label>{error&&<p role="alert" className="error">{error}</p>}</>;
}
