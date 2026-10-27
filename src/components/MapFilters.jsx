import {useEffect,useId,useRef,useState} from 'react';
import {CalendarDays,Route,SlidersHorizontal,Star,Users} from 'lucide-react';
import {toggleMapLayer} from '../lib/mapLayers.js';
const options=[['people','People & places',Users],['today','Today’s activities',CalendarDays],['pinned','Favourite activities',Star],['all','All activities',Route]];
export default function MapFilters({value,onChange}){
 const [open,setOpen]=useState(false);
 const root=useRef(null),trigger=useRef(null),id=useId();
 useEffect(()=>{
  if(!open)return;
  const outside=event=>{if(!root.current?.contains(event.target))setOpen(false);};
  document.addEventListener('pointerdown',outside);
  return()=>document.removeEventListener('pointerdown',outside);
 },[open]);
 const summary=options.filter(([key])=>value.includes(key)).map(([,label])=>label).join(' · ')||'No layers selected';
 return <div className="map-filter-toolbar" ref={root} data-open={open} onKeyDown={event=>{if(event.key==='Escape'){setOpen(false);trigger.current?.focus();}}}>
  <span className="map-filter-summary" role="status" title={summary}>{summary}</span>
  <div className="map-filter-dock"><div className="map-filter-reveal" aria-hidden={!open} inert={!open}><div className="map-filter-options" id={id} role="group" aria-label="Map filters">{options.map(([key,label,Icon],index)=><button key={key} type="button" className="map-filter-option" aria-label={label} title={label} aria-pressed={value.includes(key)} style={{'--filter-order':index}} onClick={()=>onChange(toggleMapLayer(value,key))}><Icon size={20} strokeWidth={1.8} aria-hidden="true"/></button>)}</div></div>
   <button ref={trigger} type="button" className="map-filter-trigger" aria-label="Map filters" title={open?'Close map filters':'Open map filters'} aria-controls={id} aria-expanded={open} onClick={()=>setOpen(current=>!current)}><SlidersHorizontal size={21} strokeWidth={1.8} aria-hidden="true"/><span className="map-filter-indicator" data-active={value.length>0} aria-hidden="true"/></button>
  </div>
 </div>;
}
