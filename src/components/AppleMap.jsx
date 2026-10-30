import { Maximize2, Navigation } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { appleMaps, appleMapsAvailable, forgetOverview, sendOverview } from '../lib/appleMaps.js';
import { MapLayersButton } from './MapLayers.jsx';

// `overview` is the Map overview's density/photo data (lib/mapOverview.js); it is
// sent to the native map once per key and the payload names only the key.
// `onLayers` adds the Map layers button (drawn natively once the map is embedded).
export default function AppleMap({payload:basePayload,onResult,large=false,picker=false,onLocate,locating=false,trimRange=null,embeddedEnabled=true,viewportKey=null,onCamera=null,overview=null,onLayers=null,layersActive=0,toolbar=null,onToolbarAction=null}){
 const payload={...basePayload,locate:Boolean(onLocate),locating,...(onLayers?{layers:{active:layersActive,toolbar}}:{})};
 const overviewData=useRef(overview);
 useEffect(()=>{overviewData.current=overview;},[overview]);
 const overviewKey=overview?.key||null;
 const mapSurface=useRef(null);
 const frozenHeight=useRef(0);
 const embeddedOnce=useRef(false);
 const fittedViewport=useRef(null);
 const fittedContent=useRef({positions:false,focus:false});
 const openingFullscreen=useRef(false);
 const [reopenVersion,setReopenVersion]=useState(0);
 const [embedded,setEmbedded]=useState(false);
 const [preview,setPreview]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 // While a sheet or the photo viewer is open the native map is hidden (never
 // removed, so its camera and selection survive) and this still image stands in.
 const [frozen,setFrozen]=useState(null);
 // The overview could not reach the native map. The map still shows everything
 // else; the routes are never silently missing: a notice offers a retry.
 const [overviewFailed,setOverviewFailed]=useState(null);
 const [overviewAttempt,setOverviewAttempt]=useState(0);
 const resent=useRef(new Set());
 const [projection,setProjection]=useState([]);
 const [themeVersion,setThemeVersion]=useState(0);
 useEffect(()=>{const changed=()=>setThemeVersion(v=>v+1);window.addEventListener('letm3go:theme-changed',changed);return()=>window.removeEventListener('letm3go:theme-changed',changed);},[]);
 const [mapID]=useState(()=>crypto.randomUUID());
 const locateHandler=useRef(onLocate);useEffect(()=>{locateHandler.current=onLocate;},[onLocate]);
 const toolbarHandler=useRef(onToolbarAction);useEffect(()=>{toolbarHandler.current=onToolbarAction;},[onToolbarAction]);
 const layersHandler=useRef(onLayers);useEffect(()=>{layersHandler.current=onLayers;},[onLayers]);
 const hasLayers=Boolean(onLayers);
 const hasMapActions=Boolean(onLayers||onLocate);
 useEffect(()=>{
  if(!appleMapsAvailable()||!hasMapActions)return;
  let disposed=false;let listener;
  void appleMaps.addListener('layersTapped',event=>{if(!disposed&&event?.mapID===mapID)(event.action==='locate'?locateHandler.current?.():event.action?toolbarHandler.current?.(event.action):layersHandler.current?.());})
   .then(handle=>{if(disposed)void handle.remove();else listener=handle;}).catch(()=>{});
  return()=>{disposed=true;void listener?.remove();};
 },[mapID,hasMapActions]);
 useEffect(()=>()=>{if(appleMapsAvailable()){void appleMaps.unembed({mapID}).catch(()=>{});void appleMaps.close({mapID}).catch(()=>{});}},[mapID]);
 const latest=useRef(onResult);useEffect(()=>{latest.current=onResult;},[onResult]);
 // The people map reports its own camera changes (a gesture, an edge avatar, its
 // Show everyone button) so the requested mode survives a remount.
 const cameraHandler=useRef(onCamera);useEffect(()=>{cameraHandler.current=onCamera;},[onCamera]);
 const hasCamera=Boolean(payload.camera);
 useEffect(()=>{
  if(!appleMapsAvailable()||!hasCamera)return;
  let disposed=false;let listener;
  void appleMaps.addListener('cameraChanged',event=>{if(!disposed&&event?.mapID===mapID)cameraHandler.current?.(event);})
   .then(handle=>{if(disposed)void handle.remove();else listener=handle;}).catch(()=>{});
  return()=>{disposed=true;void listener?.remove();};
 },[mapID,hasCamera]);
 const photoPins=JSON.stringify(payload.pins);
 useEffect(()=>{
  if(!appleMapsAvailable())return;
  let disposed=false;let listener;
  void appleMaps.addListener('photoSelected',result=>{
   // Overview photos live in the overview data, so they are matched by map; other
   // maps only accept a photo that is one of their own pins.
   if(disposed||!result?.photoID||!result?.journeyID)return;
   if(result.mapID?result.mapID===mapID:JSON.parse(photoPins).some(pin=>pin.kind==='photo'&&pin.photoID===result.photoID&&pin.journeyID===result.journeyID))latest.current?.(result);
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
  if(!appleMapsAvailable()||picker)return;
  if(!embeddedEnabled){void appleMaps.unembed({mapID}).catch(()=>{});embeddedOnce.current=false;return;}
  let active=true;let previous='';
  // The overview data must reach the native side before a payload names it.
  // false: the overview did not arrive, so it is left out of this embed rather
  // than named and drawn empty.
  const ready=overviewKey?sendOverview(overviewData.current).then(()=>true,()=>false):Promise.resolve(true);
  const content=JSON.parse(interactiveData);
  const positions=content.routes.some(route=>route.length)||content.pins.length>0;
  const focus=Boolean(content.focus);
  const mount=()=>{
   if(!active||openingFullscreen.current||!mapSurface.current)return;
   const surface=mapSurface.current;
   const dialog=document.querySelector('dialog[open], [aria-modal="true"], [role="dialog"], .lightbox');
   if(dialog&&!dialog.contains(surface)&&document.visibilityState!=='hidden'){
    // A sheet or the photo viewer: MapKit would cover it, so hide the map and
    // show a still image of it. It comes back exactly as it was.
    if(embeddedOnce.current&&previous!=='hidden'){previous='hidden';void appleMaps.hide({mapID,hidden:true}).then(result=>{if(active&&result?.image)setFrozen({src:result.image,height:frozenHeight.current});}).catch(()=>{});}
    return;
   }
   // The sheet closed: show the live map again (the embed below follows).
   if(previous==='hidden'){previous='';void appleMaps.hide({mapID,hidden:false}).catch(()=>{});}
   if(document.visibilityState==='hidden'){
    previous='';embeddedOnce.current=false;setEmbedded(false);setFrozen(null);
    void appleMaps.unembed({mapID}).catch(()=>{});return;
   }
   const box=surface.getBoundingClientRect();
   const nav=document.querySelector('.mobile-nav');
   const navTop=nav&&getComputedStyle(nav).display!=='none'?nav.getBoundingClientRect().top:window.innerHeight;
   const visibleHeight=Math.min(box.height,Math.max(0,navTop-box.top-8));
   if(box.width<=80||visibleHeight<=80||box.bottom<=0){if(embeddedOnce.current){void appleMaps.unembed({mapID}).catch(()=>{});embeddedOnce.current=false;setEmbedded(false);}return;}
   const geometry=[box.x,box.y,box.width,visibleHeight].map(n=>n.toFixed(1)).join(':');
   if(geometry===previous)return;
   const preserveViewport=embeddedOnce.current&&fittedViewport.current===viewportKey&&(hasLayers||((!positions||fittedContent.current.positions)&&(!focus||fittedContent.current.focus)));previous=geometry;
   frozenHeight.current=visibleHeight;
   void ready.then(arrived=>{
    // A newer payload (filter change, unmount) supersedes this one.
    if(!active)return null;
    const request={...JSON.parse(interactiveData),mapID,x:box.x,y:box.y,width:box.width,height:visibleHeight,preserveViewport};
    if(!arrived)delete request.overview;
    return appleMaps.embed(request).then(result=>({arrived,result}));
   }).then(outcome=>{
    if(!outcome||!active)return;
    embeddedOnce.current=true;fittedViewport.current=viewportKey;fittedContent.current={positions,focus};
    setEmbedded(true);setFrozen(null);
    // The native side no longer has this overview (it keeps a few): send it
    // again once, then report it.
    if(outcome.result?.missingOverview&&overviewKey){
     forgetOverview(overviewKey);
     if(!resent.current.has(overviewKey)){resent.current.add(overviewKey);previous='';setOverviewAttempt(value=>value+1);return;}
    }
    setOverviewFailed(overviewKey&&(!outcome.arrived||outcome.result?.missingOverview)?overviewKey:null);
    // A sheet may have opened while this embed was in flight.
    mount();
   }).catch(()=>{previous='';if(active){setEmbedded(false);setFrozen(null);}});
  };
  // The detail page animates into place; ResizeObserver alone does not see
  // transforms. Follow its initial movement before leaving layout to observers.
  let frame;const until=performance.now()+500;
  const settle=()=>{mount();if(active&&performance.now()<until)frame=requestAnimationFrame(settle);};
  frame=requestAnimationFrame(settle);
  const mutations=new MutationObserver(()=>mount());
  mutations.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open','aria-modal','role']});
  const observer=new ResizeObserver(mount);if(mapSurface.current)observer.observe(mapSurface.current);
  const resized=()=>{previous='';mount();};
  window.addEventListener('resize',resized);
  window.addEventListener('scroll',resized,{passive:true,capture:true});
  document.addEventListener('visibilitychange',resized);
  return()=>{active=false;cancelAnimationFrame(frame);mutations.disconnect();observer.disconnect();window.removeEventListener('resize',resized);window.removeEventListener('scroll',resized,true);document.removeEventListener('visibilitychange',resized);};
 },[interactiveData,mapID,picker,embeddedEnabled,reopenVersion,themeVersion,viewportKey,overviewKey,overviewAttempt,hasLayers]);
 const isTrimPreview=Boolean(trimRange);
 const projected=projection.flat();
 const startIndex=trimRange&&projected.length>1?Math.max(0,Math.min(projected.length-2,Math.round(trimRange.start/(trimRange.points.length-1)*(projected.length-1)))):0;
 const endIndex=trimRange&&projected.length>1?Math.max(startIndex+1,Math.min(projected.length-1,Math.round(trimRange.end/(trimRange.points.length-1)*(projected.length-1)))):0;
 const selected=trimRange&&projected.length>1?projected.slice(startIndex,endIndex+1):[];
 useEffect(()=>{let alive=true;if(!appleMapsAvailable())return;(overviewKey?sendOverview(overviewData.current).then(()=>true,()=>false):Promise.resolve(true)).then(arrived=>{const request={...JSON.parse(data),trimPreview:isTrimPreview,width:700,height:large?600:350};if(!arrived)delete request.overview;return appleMaps.snapshot(request);}).then(result=>{if(alive){setPreview(result.image);setProjection(result.projection||[]);setError('');}}).catch(()=>{if(alive)setError('Map preview unavailable. Tap to open Apple Maps.');});return()=>{alive=false;};},[data,large,themeVersion,isTrimPreview,overviewKey,overviewAttempt]);
 async function open(){
  if(busy)return;
  setBusy(true);setError('');
  openingFullscreen.current=true;
  try{
   // MapKit fullscreen presentation can appear blank while another live MKMapView
   // overlays the Capacitor WebView. Release that view before presenting.
   await appleMaps.unembed({mapID}).catch(()=>{});
   setEmbedded(false);
   const arrived=overviewKey?await sendOverview(overviewData.current).then(()=>true,()=>false):true;
   const request={...JSON.parse(interactiveData),picker,mapID};
   if(!arrived){delete request.overview;setOverviewFailed(overviewKey);}
   const result=await appleMaps.open(request);
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
 return <div className="map-frame apple-map-frame" ref={mapSurface}><button type="button" className={`${picker?'place-picker':'journey-map'} ${large?'large':''} ${isTrimPreview?'trim-preview':''} apple-map-preview ${embedded?'native-embedded':''}`} aria-label={picker?'Choose saved place in Apple Maps':'Open interactive Apple journey map'} disabled={busy||!appleMapsAvailable()} onClick={open}>{preview&&<img src={preview} alt="Apple map preview"/>}{trimRange&&selected.length>1&&<svg className="trim-map-overlay" viewBox={`0 0 700 ${large?600:350}`} preserveAspectRatio="none" aria-hidden="true"><polyline points={selected.map(p=>p.join(',')).join(' ')} fill="none" stroke="white" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"/><polyline points={selected.map(p=>p.join(',')).join(' ')} fill="none" stroke="#4659d9" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>{selected[0]&&<g transform={`translate(${selected[0][0]} ${selected[0][1]})`}><circle r="17" fill="#4659d9" fillOpacity=".17"/><circle r="11" fill="#4659d9" stroke="white" strokeWidth="2.5"/><path d="M-3.5 -6 L5 0 L-3.5 6 Z" fill="white" stroke="white" strokeLinejoin="round" strokeWidth="1.4"/></g>}{selected.at(-1)&&<g transform={`translate(${selected.at(-1)[0]} ${selected.at(-1)[1]})`}><circle r="17" fill="#4659d9" fillOpacity=".17"/><circle r="11" fill="#4659d9" stroke="white" strokeWidth="2.5"/><path d="M-5 -7 V7" stroke="white" strokeWidth="1.5" strokeLinecap="round"/><path d="M-4.5 -7 H5 V3 H-4.5 Z" fill="white"/><path d="M-4.5 -7 H.25 V-2 H-4.5 Z M.25 -2 H5 V3 H.25 Z" fill="#4659d9"/></g>}</svg>}<span className="apple-map-attribution">Apple Maps</span>{!embedded&&<span className="apple-map-open">{busy?'Opening…':picker?'Choose location':'Explore map'} <Maximize2 size={16} strokeWidth={1.8} aria-hidden="true"/></span>}{!preview&&<span className="apple-map-placeholder">{appleMapsAvailable()?'Apple Maps':'Maps are available in the iPhone app.'}</span>}</button>{frozen&&<img className="apple-map-freeze" src={frozen.src} alt="" aria-hidden="true" style={{height:`${frozen.height}px`}}/>}{onLayers&&!embedded&&<MapLayersButton active={layersActive} onClick={onLayers}/>}{overviewFailed&&overviewFailed===overviewKey&&<div className="notice map-overview-error" role="alert"><span>Routes could not be drawn on the map.</span><button type="button" className="text-button" onClick={()=>{resent.current.delete(overviewKey);forgetOverview(overviewKey);setOverviewFailed(null);setOverviewAttempt(value=>value+1);}}>Retry</button></div>}{onLocate&&!embedded&&<button type="button" className="map-locate-button" aria-label="Show my location" title="Show my location" aria-pressed={locating||(basePayload.camera?.mode==='person'&&basePayload.camera?.personId==='self')} disabled={locating} onClick={onLocate}><Navigation size={20}/></button>}{error&&<p role="status" className="notice">{error}</p>}</div>;
}
