import {useEffect} from 'react';
import {Activity,Archive,Bike,Car,ChevronLeft,ChevronRight,Footprints,Globe,Layers,ListFilter,Map,Mountain,Route,Star,Sun,Users,Waves,X} from 'lucide-react';
const icons={'map':Map,'globe.americas':Globe,'mountain.2':Mountain,'person.2':Users,'point.topleft.down.to.point.bottomright.curvepath':Route,'sun.max':Sun,'star':Star,'nosign':X,'archivebox':Archive,'figure.mixed.cardio':Activity,'car':Car,'bicycle':Bike,'figure.run':Activity,'figure.hiking':Mountain,'figure.walk':Footprints,'figure.surfing':Waves,'chevron.left':ChevronLeft,'chevron.right':ChevronRight,'xmark':X};
const glyph=(symbol,size=18)=>{const Icon=icons[symbol]||Activity;return <Icon size={size} aria-hidden="true"/>;};
function Pill({item,icon,onAction,children}){
 return <button type="button" className="map-pill" aria-label={item.label} aria-expanded={item.expanded} onClick={()=>onAction(item.id)}>{icon}<span className="map-pill-text">{item.text}</span>{children}</button>;
}
function Step({item,onAction}){
 return <button type="button" aria-label={item.label} title={item.label} disabled={item.disabled} onClick={()=>onAction(item.id)}>{glyph(item.symbol)}</button>;
}
function DateBar({date,onAction}){
 return <div className="map-date-bar" role="group" aria-label="Selected day"><Step item={date.previous} onAction={onAction}/><strong aria-label={date.accessibilityLabel}>{date.label}</strong><Step item={date.next} onAction={onAction}/>{date.today&&<button type="button" className="map-date-today" aria-label={date.today.label} onClick={()=>onAction(date.today.id)}>{date.today.text}</button>}{date.clear&&<Step item={date.clear} onAction={onAction}/>}</div>;
}
function Panel({panel,onAction}){
 return <section className="map-panel" aria-label={panel.title}><div className="map-panel-head"><h2>{panel.title}</h2>{panel.reset&&<button type="button" className="map-panel-reset" aria-label={panel.reset.label} onClick={()=>onAction(panel.reset.id)}>{panel.reset.text}</button>}<button type="button" aria-label={`Close ${panel.title}`} onClick={()=>onAction('panel:close')}><X size={20} aria-hidden="true"/></button></div>{panel.sections.map(section=><div key={section.id}><h3>{section.label}</h3><div className="map-panel-options" role="group" aria-label={section.label}>{section.options.map(item=><button type="button" key={item.id+item.label} aria-pressed={item.selected} onClick={()=>onAction(item.id)}>{item.symbol&&glyph(item.symbol)}{item.text}</button>)}</div></div>)}</section>;
}
// The web fallback of the controls AppleMaps.swift draws over the embedded map.
export default function MapControls({controls,onAction}){
 const open=Boolean(controls.panel);
 useEffect(()=>{if(!open)return;const escape=e=>{if(e.key==='Escape')onAction('panel:close');};document.addEventListener('keydown',escape);return()=>document.removeEventListener('keydown',escape);},[open,onAction]);
 return <div className="map-controls"><div className="map-controls-top">{controls.filters&&<Pill item={controls.filters} icon={<ListFilter size={18} aria-hidden="true"/>} onAction={onAction}>{controls.filters.count>0&&<span className="map-pill-count" aria-hidden="true">{controls.filters.count}</span>}</Pill>}<Pill item={controls.layers} icon={<Layers size={18} aria-hidden="true"/>} onAction={onAction}>{controls.layers.changed&&<span className="map-pill-dot" aria-hidden="true"/>}</Pill></div>{controls.date&&<DateBar date={controls.date} onAction={onAction}/>}{controls.panel&&<Panel panel={controls.panel} onAction={onAction}/>}</div>;
}
