import {useEffect} from 'react';
import {Activity,Bike,Calendar,Car,ChevronLeft,ChevronRight,Clock,Footprints,Map,Mountain,Route,Star,Sun,Users,Waves,X} from 'lucide-react';
const icons={'map':Map,'mountain.2':Mountain,'person.2':Users,'point.topleft.down.to.point.bottomright.curvepath':Route,'calendar':Calendar,'sun.max':Sun,'star':Star,'nosign':X,'figure.mixed.cardio':Activity,'car':Car,'bicycle':Bike,'figure.run':Activity,'figure.hiking':Mountain,'figure.walk':Footprints,'figure.surfing':Waves,'chevron.left':ChevronLeft,'chevron.right':ChevronRight,'clock':Clock};
function Control({item,onAction,expanded}){const Icon=icons[item.symbol]||Activity;return <button type="button" title={item.label} aria-label={item.label} aria-pressed={!!item.selected} aria-expanded={expanded} disabled={item.disabled} onClick={()=>onAction(item.id)}>{item.text||<Icon size={20} aria-hidden="true"/>}</button>;}
// The inline filter controller: categories that open a strip of options, with no
// backdrop, dialog or Apply step. Each page supplies its own serializable rows
// (lib/mapToolbar.js, lib/activityFilters.js) and keeps its own filter state.
export default function FilterToolbar({toolbar,onAction,onClose,label,className,orientation='vertical'}){
 useEffect(()=>{if(!toolbar?.open)return;const escape=e=>{if(e.key==='Escape')onClose();};document.addEventListener('keydown',escape);return()=>document.removeEventListener('keydown',escape);},[toolbar?.open,onClose]);
 if(!toolbar?.open)return null;
 return <div className={className} role="toolbar" aria-label={label} aria-orientation={orientation}>{toolbar.rows.map(row=><div className="map-filter-row" key={row.id}><Control item={row} onAction={onAction} expanded={row.options?toolbar.category===row.id:undefined}/>{row.options&&toolbar.category===row.id&&<div className="map-filter-options" role="group" aria-label={row.label}>{row.options.map(item=><Control key={`${item.id}:${item.label}`} item={item} onAction={onAction}/>)}</div>}</div>)}</div>;
}
