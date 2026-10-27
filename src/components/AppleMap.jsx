import { Maximize2, Navigation } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { appleMaps, appleMapsAvailable } from '../lib/appleMaps.js';

export default function AppleMap({payload,onResult,large=false,picker=false,onLocate,locating=false,trimRange=null,embeddedEnabled=true}){
 const mapSurface=useRef(null);
 const embeddedOnce=useRef(false);
 const openingFullscreen=useRef(false);
 const [reopenVersion,setReopenVersion]=useState(0);
 const [embedded,setEmbedded]=useState(false);
 const [preview,setPreview]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [projection,setProjection]=useState([]);
 const [themeVersion,setThemeVersion]=useState(0);
 useEffect(()=>{const changed=()=>setThemeVersion(v=>v+1);window.addEventListener('letm3go:theme-changed',changed);return()=>window.removeEventListener('letm3go:theme-changed',changed);},[]);
 const [mapID]=useState(()=>crypto.randomUUID());
 useEffect(()=>()=>{if(appleMapsAvailable()){void appleMaps.unembed({mapID}).catch(()=>{});void appleMaps.close({mapID}).catch(()=>{});}},[mapID]);
 const latest=useRef(onResult);useEffect(()=>{latest.current=onResult;},[onResult]);
 const photoPins=JSON.stringify(payload.pins);
 useEffect(()=>{
  if(!appleMapsAvailable())return;
  let disposed=false;let listener;
  void appleMaps.addListener('photoSelected',result=>{
   if(!disposed&&result?.photoID&&result?.journeyID&&JSON.parse(photoPins).some(pin=>pin.kind==='photo'&&pin.photoID===result.photoID&&pin.journeyID===result.journeyID))latest.current?.(result);
  }).then(handle=>{if(disposed)void handle.remove();else listener=handle;}).catch(()=>{});
  return()=>{disposed=true;void listener?.remove();};
 },[mapID,photoPins]);
 const data=JSON.stringify(payload);
 const interactiveData=JSON.stringify(trimRange?.points?.length>1?(()=>{
  const points=trimRange.points.slice(trimRange.start,trimRange.end+1).filter(p=>Number.isFinite(p.latitude)&&Number.isFinite(p.longitude));
  if(points.length<2)return payload;
  const routes=[];let segment=null;
  for(const point of points){
   if(point.segment!==segment){routes.push([]);segment=point.segment;}
   routes.at(-1).push([point.latitude,point.longitude]);
  }
  const pins=payload.pins.filter(pin=>!['start','finish'].includes(pin.kind));
  pins.push({point:routes[0][0],title:'Start',kind:'start'},{point:routes.at(-1).at(-1),title:'Finish',kind:'finish'});
  return {...payload,routes,pins};
 })():payload);
 useEffect(()=>{
  if(!appleMapsAvailable()||picker||!embeddedEnabled)return;
  let active=true;let previous='';
  const mount=()=>{
   if(!active||openingFullscreen.current||!mapSurface.current)return;
   const box=mapSurface.current.getBoundingClientRect();
   const nav=document.querySelector('.mobile-nav');
   const navTop=nav&&getComputedStyle(nav).display!=='none'?nav.getBoundingClientRect().top:window.innerHeight;
   const visibleHeight=Math.min(box.height,Math.max(0,navTop-box.top-8));
   if(box.width<80||visibleHeight<80){if(embeddedOnce.current){void appleMaps.unembed({mapID}).catch(()=>{});embeddedOnce.current=false;setEmbedded(false);}return;}
   const geometry=[box.x,box.y,box.width,visibleHeight].map(n=>n.toFixed(1)).join(':');
   if(geometry===previous)return;
   const preserveViewport=embeddedOnce.current;previous=geometry;
   void appleMaps.embed({...JSON.parse(interactiveData),mapID,x:box.x,y:box.y,width:box.width,height:visibleHeight,preserveViewport}).then(()=>{embeddedOnce.current=true;if(active)setEmbedded(true);}).catch(()=>{if(active)setEmbedded(false);});
  };
  const timer=setTimeout(mount,100);
  const observer=new ResizeObserver(mount);if(mapSurface.current)observer.observe(mapSurface.current);
  const resized=()=>{previous='';mount();};
  window.addEventListener('resize',resized);
  window.addEventListener('scroll',resized,{passive:true});
  return()=>{active=false;clearTimeout(timer);observer.disconnect();window.removeEventListener('resize',resized);window.removeEventListener('scroll',resized);};
 },[interactiveData,mapID,picker,embeddedEnabled,reopenVersion]);
 const isTrimPreview=Boolean(trimRange);
 const projected=projection.flat();
 const startIndex=trimRange&&projected.length>1?Math.max(0,Math.min(projected.length-2,Math.round(trimRange.start/(trimRange.points.length-1)*(projected.length-1)))):0;
 const endIndex=trimRange&&projected.length>1?Math.max(startIndex+1,Math.min(projected.length-1,Math.round(trimRange.end/(trimRange.points.length-1)*(projected.length-1)))):0;
 const selected=trimRange&&projected.length>1?projected.slice(startIndex,endIndex+1):[];
 useEffect(()=>{let alive=true;if(!appleMapsAvailable())return;appleMaps.snapshot({...JSON.parse(data),trimPreview:isTrimPreview,width:700,height:large?600:350}).then(result=>{if(alive){setPreview(result.image);setProjection(result.projection||[]);setError('');}}).catch(()=>{if(alive)setError('Map preview unavailable. Tap to open Apple Maps.');});return()=>{alive=false;};},[data,large,themeVersion,isTrimPreview]);
 async function open(){
  if(busy)return;
  setBusy(true);setError('');
  openingFullscreen.current=true;
  try{
   // MapKit fullscreen presentation can appear blank while another live MKMapView
   // overlays the Capacitor WebView. Release that view before presenting.
   await appleMaps.unembed({mapID}).catch(()=>{});
   setEmbedded(false);
   const result=await appleMaps.open({...JSON.parse(data),picker,mapID});
   latest.current?.(result);
  }catch{
   setError('The interactive map could not open. The route preview remains available; please retry.');
  }finally{
   openingFullscreen.current=false;
   embeddedOnce.current=false;
   setBusy(false);
   setReopenVersion(v=>v+1);
  }
 }
 return <div className="map-frame apple-map-frame" ref={mapSurface}><button type="button" className={`${picker?'place-picker':'journey-map'} ${large?'large':''} ${isTrimPreview?'trim-preview':''} apple-map-preview ${embedded?'native-embedded':''}`} aria-label={picker?'Choose saved place in Apple Maps':'Open interactive Apple journey map'} disabled={busy||!appleMapsAvailable()} onClick={open}>{preview&&<img src={preview} alt="Apple map preview"/>}{trimRange&&selected.length>1&&<svg className="trim-map-overlay" viewBox={`0 0 700 ${large?600:350}`} preserveAspectRatio="none" aria-hidden="true"><polyline points={selected.map(p=>p.join(',')).join(' ')} fill="none" stroke="white" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"/><polyline points={selected.map(p=>p.join(',')).join(' ')} fill="none" stroke="#4659d9" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>{selected[0]&&<g transform={`translate(${selected[0][0]} ${selected[0][1]})`}><circle r="17" fill="#4659d9" fillOpacity=".17"/><circle r="11" fill="#4659d9" stroke="white" strokeWidth="2.5"/><path d="M-3.5 -6 L5 0 L-3.5 6 Z" fill="white" stroke="white" strokeLinejoin="round" strokeWidth="1.4"/></g>}{selected.at(-1)&&<g transform={`translate(${selected.at(-1)[0]} ${selected.at(-1)[1]})`}><circle r="17" fill="#4659d9" fillOpacity=".17"/><circle r="11" fill="#4659d9" stroke="white" strokeWidth="2.5"/><path d="M-5 -7 V7" stroke="white" strokeWidth="1.5" strokeLinecap="round"/><path d="M-4.5 -7 H5 V3 H-4.5 Z" fill="white"/><path d="M-4.5 -7 H.25 V-2 H-4.5 Z M.25 -2 H5 V3 H.25 Z" fill="#4659d9"/></g>}</svg>}<span className="apple-map-attribution">Apple Maps</span><span className="apple-map-open">{busy?'Opening…':picker?'Choose location':'Explore map'} <Maximize2 size={16} strokeWidth={1.8} aria-hidden="true"/></span>{!preview&&<span className="apple-map-placeholder">{appleMapsAvailable()?'Apple Maps':'Maps are available in the iPhone app.'}</span>}</button>{onLocate&&<button type="button" className="map-locate-button" aria-label="Show my location" title="Show my location" disabled={locating} onClick={onLocate}><Navigation size={20}/></button>}{error&&<p role="status" className="notice">{error}</p>}</div>;
}
