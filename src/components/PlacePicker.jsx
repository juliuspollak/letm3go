import { useEffect, useRef } from 'react';
import L from 'leaflet';
export default function PlacePicker({point,radius,onPick}){
 const root=useRef(null);
 useEffect(()=>{
  const map=L.map(root.current,{scrollWheelZoom:false}).setView(point?[point.latitude,point.longitude]:[-33.86,151.2],point?15:10);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',{attribution:'© OpenStreetMap © CARTO',maxZoom:19}).addTo(map);
  if(point)L.circle([point.latitude,point.longitude],{radius,color:'#dc714b',fillOpacity:.12}).addTo(map);
  map.on('click',e=>onPick({latitude:e.latlng.lat,longitude:e.latlng.lng}));
  const observer=new ResizeObserver(()=>map.invalidateSize());observer.observe(root.current);
  return()=>{observer.disconnect();map.remove();};
 },[point,radius,onPick]);
 return <div ref={root} className="place-picker" aria-label="Tap map to position saved place"/>;
}
