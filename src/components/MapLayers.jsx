import {SlidersHorizontal} from 'lucide-react';
import FilterToolbar from './FilterToolbar.jsx';
export default function MapLayers({toolbar,onAction,onClose}){
 return <FilterToolbar className="map-filter-toolbar" label="Map filters" toolbar={toolbar} onAction={onAction} onClose={onClose}/>;
}
export function MapLayersButton({active=0,onClick}){
 return <button type="button" className="map-layers-button" aria-label={active?`Map layers, ${active} active`:'Map layers'} onClick={onClick}><SlidersHorizontal size={20} aria-hidden="true"/>{active>0&&<span className="map-layers-dot" aria-hidden="true"/>}</button>;
}
