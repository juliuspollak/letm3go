import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { displaySegments } from '../lib/mapGeometry.js';
import { resolvePhoto } from '../lib/privateMedia.js';

export default function JourneyMap({ journeys, onPhoto, large=false, currentPosition=null }) {
  const container=useRef(null);
  const geometry=JSON.stringify(journeys.slice(0,50).map(j=>({id:j.id,route:j.source?displaySegments(j).flat():j.route,routeSegments:j.source?displaySegments(j):j.routeSegments,photos:j.photos})));
  useEffect(()=>{
    const map=L.map(container.current,{scrollWheelZoom:false,zoomControl:false}).setView([0,0],2);
    L.control.zoom({position:'bottomright'}).addTo(map);
    const light=L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',{attribution:'&copy; OpenStreetMap contributors &copy; CARTO',maxZoom:19}).addTo(map);
    const street=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; OpenStreetMap contributors',maxZoom:19});
    L.control.layers({Light:light,Street:street}).addTo(map);
    const bounds=[];
    JSON.parse(geometry).forEach(j=>{
      if(!j.route.length)return;
      bounds.push(...j.route);
      (j.routeSegments||[j.route]).forEach(segment=>{
        L.polyline(segment,{color:'#ffffff',weight:8}).addTo(map);
        L.polyline(segment,{color:'#db663f',weight:4,lineCap:'round'}).addTo(map);
      });
      [j.route[0],j.route.at(-1)].forEach((p,i)=>L.marker(p,{icon:L.divIcon({className:'route-marker',html:i?'⚑':'',iconSize:[20,20]})}).addTo(map).bindTooltip(i?'Finish':'Start'));
      j.photos.filter(p=>p.point).forEach(p=>{
        const button=document.createElement('button');button.className=`photo-pin ${p.locationSource==='inferred'?'inferred-photo':''}`;button.setAttribute('aria-label',`View photo: ${p.caption}`);
        const img=document.createElement('img');img.alt=p.caption;button.append(img);
        resolvePhoto(p.url).then(url=>{if(container.current?.contains(button))img.src=url;}).catch(()=>{button.title='Photo unavailable';});
        button.onclick=()=>onPhoto?.(j,p.id);
        L.marker(p.point,{icon:L.divIcon({className:'photo-marker',html:button,iconSize:[48,48],iconAnchor:[24,24]})}).addTo(map);
      });
    });
    if(currentPosition){const point=[currentPosition.latitude,currentPosition.longitude];bounds.push(point);L.circleMarker(point,{radius:7,color:'#1676ba'}).addTo(map).bindTooltip('Your current location');L.circle(point,{radius:currentPosition.accuracy,color:'#1676ba',weight:1}).addTo(map);}
    if(bounds.length)map.fitBounds(bounds,{padding:[45,55],maxZoom:14});
    const observer=new ResizeObserver(()=>map.invalidateSize());observer.observe(container.current);
    return ()=>{observer.disconnect();map.remove();};
  },[geometry,onPhoto,currentPosition]);
  return <div ref={container} className={`journey-map ${large?'large':''}`} aria-label="Interactive journey route map" />;
}
