import {useEffect} from 'react';
import {Check,Map as MapIcon,Mountain,SlidersHorizontal,X} from 'lucide-react';
import DismissibleSheet from './DismissibleSheet.jsx';
import Switch from './Switch.jsx';
import {RANGE_OPTIONS,ROUTE_LAYERS,chooseRouteLayer,clearMapFilters,supportsActivity,supportsRange} from '../lib/mapLayers.js';

// The one Map layers control. A bottom sheet over a dimmed backdrop: while it is
// open the embedded native map is frozen as an image (see AppleMap), so the
// sheet is never drawn underneath MapKit. Choosing which map to show closes it;
// toggles apply immediately and leave it open.
export default function MapLayers({open,view,onChange,onClose,activities=[]}){
 useEffect(()=>{
  if(!open)return;
  const escape=event=>{if(event.key==='Escape')onClose();};
  document.addEventListener('keydown',escape);
  return()=>document.removeEventListener('keydown',escape);
 },[open,onClose]);
 if(!open)return null;
 const filtered=(supportsActivity(view)&&view.activity)||(supportsRange(view)&&view.range!=='any');
 return <div className="modal-backdrop map-layers-backdrop" onClick={onClose}><DismissibleSheet label="Map layers" onClose={onClose}>
  <div className="map-layers-head"><h2>Map layers</h2><button type="button" className="icon-button map-layers-close" aria-label="Close map layers" onClick={onClose}><X size={20}/></button></div>
  <div className="map-layers-content" role="radiogroup" aria-label="Map">
   {[['routes','My routes',MapIcon],['trails','Community trails',Mountain]].map(([id,label,Icon])=><button key={id} type="button" role="radio" aria-checked={view.content===id} className="map-layers-tile" onClick={()=>{onChange({...view,content:id});onClose();}}><Icon size={22} aria-hidden="true"/><span>{label}</span></button>)}
  </div>
  {view.content==='routes'&&<>
   <h3 className="map-layers-label" id="map-layers-show">Show on map</h3>
   <div className="grouped-list" role="group" aria-labelledby="map-layers-show">
    <div className="grouped-row"><label htmlFor="map-layers-people">People & places</label><Switch id="map-layers-people" checked={view.people} label="People & places" onChange={people=>onChange({...view,people})}/></div>
    {ROUTE_LAYERS.map(([id,label])=><button key={id} type="button" className="grouped-row" aria-pressed={view.routes===id} onClick={()=>onChange(chooseRouteLayer(view,id))}><span>{label}</span>{view.routes===id&&<Check size={19} className="grouped-check" aria-hidden="true"/>}</button>)}
   </div>
   {supportsActivity(view)&&<>
    <div className="map-layers-label-row"><h3 className="map-layers-label" id="map-layers-filters">Filters</h3>{filtered&&<button type="button" className="text-button" onClick={()=>onChange(clearMapFilters(view))}>Clear filters</button>}</div>
    <div className="grouped-list" role="group" aria-labelledby="map-layers-filters">
     {activities.length>0&&<label className="grouped-row">Activity<select value={view.activity} onChange={event=>onChange({...view,activity:event.target.value})}><option value="">All</option>{activities.map(activity=><option key={activity}>{activity}</option>)}</select></label>}
     {supportsRange(view)&&<label className="grouped-row">Date<select value={view.range} onChange={event=>onChange({...view,range:event.target.value})}>{RANGE_OPTIONS.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>}
    </div>
   </>}
  </>}
  <button type="button" className="primary full map-layers-done" onClick={onClose}>Done</button>
 </DismissibleSheet></div>;
}

// The fallback trigger (web, and before the native map is embedded). On iPhone
// the embedded map draws the same button natively in its top-left corner.
export function MapLayersButton({active=0,onClick}){
 return <button type="button" className="map-layers-button" aria-label={active?`Map layers, ${active} active`:'Map layers'} onClick={onClick}><SlidersHorizontal size={20} strokeWidth={1.9} aria-hidden="true"/>{active>0&&<span className="map-layers-dot" aria-hidden="true"/>}</button>;
}
