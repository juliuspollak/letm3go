import {useEffect} from 'react';
import {Activity,Bike,Calendar,Car,ChevronLeft,ChevronRight,Clock,Footprints,Map,Mountain,Route,SlidersHorizontal,Star,Sun,Users,Waves,X} from 'lucide-react';
const icons={'map':Map,'mountain.2':Mountain,'person.2':Users,'point.topleft.down.to.point.bottomright.curvepath':Route,'calendar':Calendar,'sun.max':Sun,'star':Star,'nosign':X,'figure.mixed.cardio':Activity,'car':Car,'bicycle':Bike,'figure.run':Activity,'figure.hiking':Mountain,'figure.walk':Footprints,'figure.surfing':Waves,'chevron.left':ChevronLeft,'chevron.right':ChevronRight,'clock':Clock};
function Control({item,onAction,expanded}){const Icon=icons[item.symbol]||Activity;return <button type="button" title={item.label} aria-label={item.label} aria-pressed={!!item.selected} aria-expanded={expanded} disabled={item.disabled} onClick={()=>onAction(item.id)}>{item.text||<Icon size={20} aria-hidden="true"/>}</button>;}
export default function MapLayers({toolbar,onAction,onClose}){
 useEffect(()=>{if(!toolbar?.open)return;const escape=e=>{if(e.key==='Escape')onClose();};document.addEventListener('keydown',escape);return()=>document.removeEventListener('keydown',escape);},[toolbar?.open,onClose]);
 if(!toolbar?.open)return null;
 return <div className="map-filter-toolbar" role="toolbar" aria-label="Map filters" aria-orientation="vertical">{toolbar.rows.map(row=><div className="map-filter-row" key={row.id}><Control item={row} onAction={onAction} expanded={row.options?toolbar.category===row.id:undefined}/>{row.options&&toolbar.category===row.id&&<div className="map-filter-options" role="group" aria-label={row.label}>{row.options.map(item=><Control key={item.id} item={item} onAction={onAction}/>)}</div>}</div>)}</div>;
}
export function MapLayersButton({active=0,onClick}){
 return <button type="button" className="map-layers-button" aria-label={active?`Map layers, ${active} active`:'Map layers'} onClick={onClick}><SlidersHorizontal size={20} aria-hidden="true"/>{active>0&&<span className="map-layers-dot" aria-hidden="true"/>}</button>;
}
