import {activityLabel,activityCode} from '../lib/activityNames.js';
import { useId, useState } from 'react';
import {itemCategory,itemTitle} from '../lib/collection.js';
const types=['Walking','Running','Cycling','MTB','Road cycling','Other','Driving','Kitesurfing','Hiking','Unknown'];
export default function ActivityEditor({trip,vehicles=[],run,onSaved,busy,error,historical=false}){
 const [message,setMessage]=useState('');
 const formID=useId();
 // Archived items are not selectable, but a trip that already names one keeps
 // its label as a saved option instead of silently losing the assignment.
 const choices=vehicles.filter(v=>!v.archived);
 const equipmentValue=choices.some(v=>String(v.id)===String(trip?.vehicleID))?trip.vehicleID:trip?.vehicle?'__saved':'';
 async function save(e){e.preventDefault();const data=new FormData(e.currentTarget);let result;
 const chosenID=data.get('vehicleID');const savedName=trip?.vehicle;
 const item=chosenID&&chosenID!=='__saved'?vehicles.find(v=>String(v.id)===String(chosenID)):null;
 const chosen=!chosenID?{vehicle:undefined,vehicleID:undefined}:chosenID==='__saved'?{vehicle:savedName||undefined,vehicleID:undefined}:{vehicle:item?itemTitle(item):undefined,vehicleID:item?.id};
 if(historical){result=await run('addHistorical',{title:data.get('title'),activity:data.get('activity'),...chosen,startedAt:new Date(data.get('date')).getTime()/1000,seconds:Number(data.get('minutes'))*60,meters:Number(data.get('distance'))*1000});}
 else result=await run('editActivity',{id:trip.id,title:data.get('title'),activity:data.get('activity'),description:data.get('description'),notes:data.get('notes'),tags:data.get('tags').split(',').map(t=>t.trim()).filter(Boolean),collection:data.get('collection'),...chosen});
 if(result)onSaved(result,historical?result.trips[0].id:trip.id);else setMessage('Changes were not saved. Review the error and retry.');}
 return <><p className="eyebrow">{historical?'ADD A MEMORY':'YOUR JOURNEY, YOUR WORDS'}</p><div className="activity-editor-toolbar"><h2>{historical?'Add a past activity.':'Edit activity.'}</h2><button type="submit" form={formID} className="primary" disabled={busy} aria-label="Save activity">{busy?'Saving…':'Save'}</button></div>{(error||message)&&<p role="alert" className="error">{error||message}</p>}<p className="muted">Private and saved on this device. Your activity correction takes precedence over predictions.</p><form id={formID} onSubmit={save}><label>Title<input name="title" defaultValue={trip?.title} required maxLength={150}/></label><label>Activity<select name="activity" defaultValue={activityCode(trip?.activity||'Walking')}>{types.map(t=><option key={t} value={t}>{activityLabel(t)}</option>)}</select></label>{historical?<><label>Date and time<input name="date" type="datetime-local" required/></label><label>Duration in minutes<input name="minutes" type="number" min="0" max="10080" step="0.1" required/></label><label>Distance in km<input name="distance" type="number" min="0" max="2000" step="0.01" required/></label></>:<><label>Description<textarea name="description" defaultValue={trip?.description} maxLength={4000} rows={3}/></label><label>Notes<textarea name="notes" defaultValue={trip?.notes} maxLength={4000} rows={3}/></label><label>Tags (comma separated)<input name="tags" defaultValue={trip?.tags?.join(', ')} maxLength={1000}/></label><label>Holiday / collection<input name="collection" defaultValue={trip?.collection} maxLength={100}/></label></>}<label>Equipment<select name="vehicleID" defaultValue={equipmentValue}><option value="">No equipment</option>{trip?.vehicle&&!choices.some(v=>String(v.id)===String(trip.vehicleID))&&<option value="__saved">{trip.vehicle} (saved with this activity)</option>}{choices.map(v=><option key={v.id} value={v.id}>{itemTitle(v)} · {itemCategory(v).label}</option>)}</select></label></form></>;
}
