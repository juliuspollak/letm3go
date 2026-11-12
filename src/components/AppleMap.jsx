import { Maximize2, Navigation, Footprints, Bike, Car, Activity } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { appleMaps, appleMapsAvailable, forgetOverview, sendOverview } from '../lib/appleMaps.js';
import MapControls from './MapLayers.jsx';
import {newUUID} from '../lib/uuid.js';
import {installMapDiagnostics,mapDiagnosticsEnabled,recordMapEvent,recordMapFrame,recordMapLayout,snapshot as mapDiagnosticsSnapshot} from '../lib/mapDiagnostics.js';
import {frameMatches,geometryKey,surfaceGeometry} from '../lib/mapViewport.js';

// `overview` is the Map overview's density/photo data (lib/mapOverview.js); it is
// sent to the native map once per key and the payload names only the key.
// `controls` (lib/mapToolbar.mapControls) adds the Map page's controls, drawn
// natively once the map is embedded; their actions come back to `onControl`.
export default function AppleMap({payload:basePayload,onResult,large=false,picker=false,onLocate,locating=false,embeddedEnabled=true,viewportKey=null,onCamera=null,overview=null,controls=null,onControl=null,onRegion=null,onSegment=null,onStep=null,dynamic=false}){
 // The payload is derived from props on every render; memoising it keeps the
 // derived serialisation below stable so a re-render that did not change the map
 // content (for example a photo pin selection or an unrelated parent update)
 // does not re-serialise the whole route.
 const payload=useMemo(()=>({...basePayload,locate:Boolean(onLocate),locating,...(controls?{layers:{active:controls.active,controls},mapStyle:controls.style}:{})}),[basePayload,onLocate,locating,controls]);
 const overviewData=useRef(overview);
 useEffect(()=>{overviewData.current=overview;},[overview]);
 const overviewKey=overview?.key||null;
 const mapSurface=useRef(null);
 const frozenHeight=useRef(0);
 const embeddedOnce=useRef(false);
 const embedSent=useRef(false);
 // Every frame request carries the next number, taken when the page MEASURES (not when the call is made),
 // so the native side can ignore one that was measured before a request it has already applied.
 const layoutSeq=useRef(0);
 const fittedViewport=useRef(null);
 const fittedContent=useRef({positions:false,focus:false});
 const openingFullscreen=useRef(false);
 const hiddenForDialog=useRef(false);
 const [reopenVersion]=useState(0);
 const [embedded,setEmbedded]=useState(false);
 const [previewState,setPreview]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 // While a sheet or the photo viewer is open the native map is hidden (never
 // removed, so its camera and selection survive) and this still image stands in.
 const [frozen,setFrozen]=useState(null);
 // The overview could not reach the native map. The map still shows everything
 // else; the routes are never silently missing: a notice offers a retry.
 const [overviewFailed,setOverviewFailed]=useState(null);
 const [overviewAttempt,setOverviewAttempt]=useState(0);
 const resent=useRef(new Set());
 const [themeVersion,setThemeVersion]=useState(0);
 useEffect(()=>{const changed=()=>setThemeVersion(v=>v+1);window.addEventListener('letm3go:theme-changed',changed);return()=>window.removeEventListener('letm3go:theme-changed',changed);},[]);
 const [mapID]=useState(newUUID);
 // Release the native map only when this component (or its mapID) really goes
 // away. A dependency change that re-applies content must keep the live instance:
 // unembedding it here would drop the camera the sheet is meant to preserve.
 useEffect(()=>()=>{
  if(!appleMapsAvailable())return;
  if(embeddedOnce.current||embedSent.current){recordMapEvent('unembed',{reason:'unmount'});void appleMaps.unembed({mapID}).catch(()=>{}).finally(()=>{void appleMaps.close({mapID}).catch(()=>{});});}
  else void appleMaps.close({mapID}).catch(()=>{});
 },[mapID]);
 const locateHandler=useRef(onLocate);useEffect(()=>{locateHandler.current=onLocate;},[onLocate]);
 const controlHandler=useRef(onControl);useEffect(()=>{controlHandler.current=onControl;},[onControl]);
 const hasLayers=Boolean(controls);
 const hasMapActions=Boolean(controls||onLocate);
 useEffect(()=>{
  if(!appleMapsAvailable()||!hasMapActions)return;
  let disposed=false;let listener;
  void appleMaps.addListener('layersTapped',event=>{if(!disposed&&event?.mapID===mapID&&event.action)(event.action==='locate'?locateHandler.current?.():controlHandler.current?.(event.action));})
   .then(handle=>{if(disposed)void handle.remove();else listener=handle;}).catch(()=>{});
  return()=>{disposed=true;void listener?.remove();};
 },[mapID,hasMapActions]);
 // Read-only evidence for the performance notes and for a reviewer on a device:
 // window.letm3goMapDiagnostics() reports embed/resize/update/snapshot/hide/
 // unembed counts and frame times. Nothing is uploaded and nothing is sent
 // unless a diagnostics screen asks for it.
 useEffect(()=>installMapDiagnostics(mapDiagnosticsSnapshot),[]);
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
 // The visible area once the map settles, and taps on community segment pins.
 // Listened to only when asked for, so other maps pay nothing.
 const regionHandler=useRef(onRegion);useEffect(()=>{regionHandler.current=onRegion;},[onRegion]);
 const segmentHandler=useRef(onSegment);useEffect(()=>{segmentHandler.current=onSegment;},[onSegment]);
 const stepHandler=useRef(onStep);useEffect(()=>{stepHandler.current=onStep;},[onStep]);
 const wantsRegion=Boolean(onRegion),wantsSegments=Boolean(onSegment),wantsSteps=Boolean(onStep);
 useEffect(()=>{
  if(!appleMapsAvailable()||(!wantsRegion&&!wantsSegments&&!wantsSteps))return;
  let disposed=false;const listeners=[];
  const keep=promise=>promise.then(handle=>{if(disposed)void handle.remove();else listeners.push(handle);}).catch(()=>{});
  if(wantsRegion)keep(appleMaps.addListener('regionChanged',event=>{
   if(disposed||event?.mapID!==mapID)return;
   const box={minLat:event.minLat,maxLat:event.maxLat,minLon:event.minLon,maxLon:event.maxLon};
   if(Object.values(box).every(Number.isFinite))regionHandler.current?.(box);
  }));
  if(wantsSegments)keep(appleMaps.addListener('segmentSelected',event=>{if(!disposed&&event?.mapID===mapID&&event.segmentID)segmentHandler.current?.(String(event.segmentID));}));
  if(wantsSteps)keep(appleMaps.addListener('stepSelected',event=>{if(!disposed&&event?.mapID===mapID&&event.activityID)stepHandler.current?.(String(event.activityID));}));
  return()=>{disposed=true;for(const listener of listeners)void listener.remove();};
 },[mapID,wantsRegion,wantsSegments,wantsSteps]);
 const photoPins=JSON.stringify(payload.pins);
 // React render and overlay counts, so the claims about re-render cost and overlay
 // drawing can be checked from the same counters as the native lifecycle.
 useEffect(()=>{recordMapEvent('render');});
 // A listener must not be torn down and re-added every time somebody moves.
 const photoPinsRef=useRef([]);
 useEffect(()=>{try{photoPinsRef.current=JSON.parse(photoPins);}catch{photoPinsRef.current=[];}},[photoPins]);
 useEffect(()=>{
  if(!appleMapsAvailable())return;
  let disposed=false;let listener;
  void appleMaps.addListener('photoSelected',result=>{
   // Overview photos live in the overview data, so they are matched by map; other
   // maps only accept a photo that is one of their own pins.
   if(disposed||!result?.photoID||!result?.journeyID)return;
   if(result.mapID?result.mapID===mapID:photoPinsRef.current.some(pin=>pin.kind==='photo'&&pin.photoID===result.photoID&&pin.journeyID===result.journeyID))latest.current?.(result);
  }).then(handle=>{if(disposed)void handle.remove();else listener=handle;}).catch(()=>{});
  return()=>{disposed=true;void listener?.remove();};
 },[mapID]);
 // The whole payload is re-serialised on every movement anyway; the value that
// matters here is content *structure*, so the heavy string is not kept around and
// a live position update must not force a new snapshot.
 const interactiveData=useMemo(()=>JSON.stringify(payload),[payload]);
 // A live position changes the content, not the map's structure. Keep the latest
 // payload in a ref and re-embed only when routes, pins, filters, camera mode or
 // other structure changes; ordinary movement goes through the native incremental
 // update call and preserves camera, gestures, selection, routes and photos.
 const latestContent=useMemo(()=>JSON.parse(interactiveData),[interactiveData]);
 const contentRef=useRef(latestContent);
 useEffect(()=>{contentRef.current=latestContent;},[latestContent]);
 // `dynamic`: a person's day. Its lines, live trail and markers change constantly (GPS
 // points, the time slider, a new day) and always go through update(), never a
 // re-embed; only `fitKey` asks the native map to bring a new day into view.
 // Community segment lines and pins (the Map's Segments layer) change as the map
 // moves; they go through update(), never a re-embed.
 const structureKey=useMemo(()=>JSON.stringify(latestContent,(key,value)=>dynamic&&['routes','gaps','estimated','live','pins','fitKey','focus'].includes(key)?undefined:key==='pins'&&Array.isArray(value)?value.filter(pin=>pin.kind!=='photo'&&pin.kind!=='people'&&!pin.segmentID):key==='styled'&&Array.isArray(value)?value.filter(line=>!line.community):['selected','point','label','title','subtitle','members','secondsAtPlace','activity','state','accuracy','radius','speed','fit'].includes(key)?undefined:value),[latestContent,dynamic]);
 const snapshotKey=useMemo(()=>JSON.stringify(latestContent,(key,value)=>['selected','point','label','title','subtitle','members','secondsAtPlace','activity','state','accuracy','radius','speed','fit'].includes(key)?undefined:value),[latestContent]);
 // A geometry change immediately withholds its old screenshot while the new one loads.
 const preview=previewState?.key===snapshotKey?previewState.image:'';
 useEffect(()=>{
  if(!appleMapsAvailable()||picker||!embeddedOnce.current)return;
  recordMapEvent('update');void appleMaps.update({...latestContent,mapID}).catch(()=>{});
 },[latestContent,mapID,picker,embedded]);
 useEffect(()=>{
  if(!appleMapsAvailable()||picker)return;
  if(!embeddedEnabled){const wasEmbedded=embeddedOnce.current;embeddedOnce.current=false;if(wasEmbedded)recordMapEvent('unembed',{reason:'disabled'});void appleMaps.unembed({mapID}).catch(()=>{}).finally(()=>setEmbedded(false));return;}
  let active=true;let previous='';let heals=0;let lastReported='';
  // The overview data must reach the native side before a payload names it.
  // false: the overview did not arrive, so it is left out of this embed rather
  // than named and drawn empty.
  const ready=overviewKey?sendOverview(overviewData.current).then(()=>true,()=>false):Promise.resolve(true);
  const content=contentRef.current;
  const positions=content.routes.some(route=>route.length)||content.pins.length>0;
  const focus=Boolean(content.focus);
  // Moves the existing native map to a measured frame, then checks where it really is.
  const sendResize=geometry=>{
   const layoutNumber=++layoutSeq.current;
   recordMapEvent('resize',{width:geometry.width,height:geometry.height});
   void appleMaps.resize({mapID,x:geometry.x,y:geometry.y,pageX:geometry.pageX,pageY:geometry.pageY,layoutSeq:layoutNumber,width:geometry.width,height:geometry.height})
    .then(result=>{if(result?.missing){previous='';if(active)mount();return;}verify(result?.frame,layoutNumber);})
    .catch(()=>{previous='';if(active)mount();});
  };
  // The native side reports the frame it applied, in the page's own coordinates. If the page has moved on
  // (layout changed while the request was in flight) or the two ever disagree, the map is moved to what the
  // page measures now. Bounded, so it can never loop; a real layout change starts the count again.
  const verify=(frame,answered)=>{
   // An answer to a request that a newer one has replaced says nothing about where the map is going to be:
   // the newer request is checked when it answers.
   if(!active||!frame||!mapSurface.current||answered!==layoutSeq.current)return;
   const now=surfaceGeometry(mapSurface.current,window);
   if(now)recordMapLayout({html:{x:now.pageX,y:now.pageY,width:now.width,height:now.height},native:frame,scrollY:now.scrollY,navTop:now.navTop,viewportHeight:now.viewportHeight,seq:layoutSeq.current,matches:frameMatches(frame,now)});
   if(!now?.visible||frameMatches(frame,now))return;
   // Moving the map did not change where the native side says it is: the two measure from different
   // origins by a constant, which more moves cannot fix. Stop, and leave the evidence in the diagnostics.
   const reported=[frame.x,frame.y,frame.width,frame.height].join(':');
   if(heals>=3||reported===lastReported){recordMapEvent('heal-gave-up');return;}
   lastReported=reported;
   heals++;recordMapEvent('heal',{attempt:heals});
   previous=geometryKey(now);frozenHeight.current=now.height;
   sendResize(now);
  };
  const mount=(origin)=>{
   if(!active||openingFullscreen.current||!mapSurface.current)return;
   const surface=mapSurface.current;
   const dialog=document.querySelector('dialog[open], [aria-modal="true"], [role="dialog"], .lightbox');
   if(dialog&&!dialog.contains(surface)&&document.visibilityState!=='hidden'){
    // A sheet or the photo viewer: MapKit would cover it, so hide the map and
    // show a still image of it. It comes back exactly as it was.
    if(embeddedOnce.current&&!hiddenForDialog.current){hiddenForDialog.current=true;const captured=contentRef.current;recordMapEvent('hide');void appleMaps.hide({mapID,hidden:true}).then(result=>{if(active&&result?.image){setFrozen({src:result.image,height:frozenHeight.current,content:captured});recordMapEvent('frozen');}}).catch(()=>{});}
    return;
   }
   // The sheet closed: show the live map again (the embed below follows).
   if(hiddenForDialog.current){hiddenForDialog.current=false;previous='';void appleMaps.hide({mapID,hidden:false}).catch(()=>{});}
   if(document.visibilityState==='hidden'){
    // Do not destroy the map or its camera on background: the native view survives
    // suspension, and the cached geometry key stays valid, so resume re-measures
    // and re-fits only if the viewport genuinely changed (handled by resize).
    return;
   }
   const geometry=surfaceGeometry(surface,window);
   if(!geometry?.visible){if(embeddedOnce.current){previous='';recordMapEvent('unembed',{reason:'not-visible'});void appleMaps.unembed({mapID}).catch(()=>{});embeddedOnce.current=false;setEmbedded(false);}return;}
   const key=geometryKey(geometry);
   if(key===previous){if(origin==='scroll')recordMapEvent('scroll-ignored');return;}
   heals=0;lastReported='';
   // A sheet detent, rotation or keyboard changes only the frame. Moving the map
   // the person is already looking at keeps its camera, overlays, selection and
   // gestures and costs one frame-sized bridge call instead of a full content
   // re-apply — this is what makes dragging the details sheet smooth.
   if(embeddedOnce.current&&previous&&typeof appleMaps.resize==='function'){
    previous=key;heals=0;frozenHeight.current=geometry.height;
    sendResize(geometry);
    return;
   }
   const layoutNumber=++layoutSeq.current;
   const preserveViewport=embeddedOnce.current&&fittedViewport.current===viewportKey&&(hasLayers||((!positions||fittedContent.current.positions)&&(!focus||fittedContent.current.focus)));previous=key;
   frozenHeight.current=geometry.height;
   recordMapEvent('embed',{preserveViewport});
   void ready.then(arrived=>{
    // A newer payload (filter change, unmount) supersedes this one.
    if(!active)return null;
    const request={...contentRef.current,mapID,x:geometry.x,y:geometry.y,pageX:geometry.pageX,pageY:geometry.pageY,layoutSeq:layoutNumber,width:geometry.width,height:geometry.height,preserveViewport};
    if(!arrived)delete request.overview;
    embedSent.current=true;
    return appleMaps.embed(request).then(result=>({arrived,result}));
   }).then(outcome=>{
    if(!outcome||!active)return;
    embeddedOnce.current=true;fittedViewport.current=viewportKey;fittedContent.current={positions,focus};
    setEmbedded(true);setFrozen(null);
    verify(outcome.result?.frame,layoutNumber);
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
  // Frame durations are sampled around the interactions that can stutter: page
  // entry, a page scroll and a sheet drag. Sampling runs only while something is
  // moving, so the numbers describe the gesture instead of idle time.
  let frame;const until=performance.now()+500;let lastFrameAt=performance.now();
  let sampleFrame=null,samplingUntil=0;
  // Frame sampling is only useful for a measurement. Without the opt-in flag the
  // page-scroll and mutation observers must not start a rAF loop per interaction.
  const diagnostics=mapDiagnosticsEnabled();
  const tick=()=>{const now=performance.now();recordMapFrame(now-lastFrameAt);lastFrameAt=now;sampleFrame=now<samplingUntil?requestAnimationFrame(tick):null;};
  const sampleFor=milliseconds=>{if(!diagnostics)return;samplingUntil=Math.max(samplingUntil,performance.now()+milliseconds);if(!sampleFrame){lastFrameAt=performance.now();sampleFrame=requestAnimationFrame(tick);}};
  const settle=()=>{const now=performance.now();if(diagnostics)recordMapFrame(now-lastFrameAt);lastFrameAt=now;mount();if(active&&performance.now()<until)frame=requestAnimationFrame(settle);};
  frame=requestAnimationFrame(settle);
  const mutations=new MutationObserver(()=>{sampleFor(300);mount();});
  mutations.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open','aria-modal','role']});
  const observer=new ResizeObserver(()=>{sampleFor(300);mount();});
  // The map can move without changing size: anything above it growing or shrinking changes its
  // ancestors' sizes, and the tab bar's size sets where the map must stop, so all of them are watched.
  for(let element=mapSurface.current;element&&element!==document.documentElement;element=element.parentElement)observer.observe(element);
  const tabBar=document.querySelector('.mobile-nav');if(tabBar)observer.observe(tabBar);
  const resized=()=>mount();
  window.addEventListener('resize',resized);window.addEventListener('orientationchange',resized);window.addEventListener('pageshow',resized);
  const viewport=window.visualViewport;viewport?.addEventListener?.('resize',resized);
  // A CSS transition or animation moves things without any size event until it ends. Many end at once and
  // most are nowhere near the map, so they are folded into one check per frame.
  let queuedFrame=0;const queued=()=>{if(queuedFrame)return;queuedFrame=requestAnimationFrame(()=>{queuedFrame=0;mount();});};
  document.addEventListener('transitionend',queued,true);document.addEventListener('animationend',queued,true);
  // A page scroll moves the native map with the WebView's own scroll view, so the
  // listener only has to handle maps inside an inner scroll container. mount()
  // compares document-space geometry, so an ordinary page scroll costs nothing -
  // and is counted as such, which is what backs the "scrolls are free" claim.
  const scrolled=()=>{sampleFor(600);mount('scroll');};
  window.addEventListener('scroll',scrolled,{passive:true,capture:true});
  document.addEventListener('visibilitychange',resized);
  return()=>{active=false;cancelAnimationFrame(frame);if(sampleFrame)cancelAnimationFrame(sampleFrame);mutations.disconnect();observer.disconnect();window.removeEventListener('resize',resized);window.removeEventListener('orientationchange',resized);window.removeEventListener('pageshow',resized);viewport?.removeEventListener?.('resize',resized);document.removeEventListener('transitionend',queued,true);document.removeEventListener('animationend',queued,true);cancelAnimationFrame(queuedFrame);window.removeEventListener('scroll',scrolled,true);document.removeEventListener('visibilitychange',resized);};
 },[structureKey,mapID,picker,embeddedEnabled,reopenVersion,themeVersion,viewportKey,overviewKey,overviewAttempt,hasLayers]);
 useEffect(()=>{let alive=true;if(!appleMapsAvailable()||embedded)return;(overviewKey?sendOverview(overviewData.current).then(()=>true,()=>false):Promise.resolve(true)).then(arrived=>{const request={...contentRef.current,width:700,height:large?600:350};if(!arrived)delete request.overview;return appleMaps.snapshot(request);}).then(result=>{recordMapEvent('snapshot');if(alive){setPreview({key:snapshotKey,image:result.image});setError('');}}).catch(()=>{if(alive)setError('Map preview unavailable. Tap to open Apple Maps.');});return()=>{alive=false;};},[snapshotKey,large,themeVersion,overviewKey,overviewAttempt,embedded]);
 async function open(){
  if(busy)return;
  setBusy(true);setError('');
  openingFullscreen.current=true;
  try{
   // The native side preserves the embedded map's camera across fullscreen: it
   // hides the map, opens on the same view, and resumes it on close. This fallback
   // path (picker/web) never destroys the map, so the camera survives open/close.
   const arrived=overviewKey?await sendOverview(overviewData.current).then(()=>true,()=>false):true;
   const request={...JSON.parse(interactiveData),picker,mapID};
   if(!arrived){delete request.overview;setOverviewFailed(overviewKey);}
   const result=await appleMaps.open(request);
   latest.current?.(result);
  }catch{
   setError('The interactive map could not open. The route preview remains available; please retry.');
  }finally{
   openingFullscreen.current=false;
   setBusy(false);
  }
 }
 return <div className="map-frame apple-map-frame" ref={mapSurface}><button type="button" className={`${picker?'place-picker':'journey-map'} ${large?'large':''} apple-map-preview ${embedded?'native-embedded':''}`} aria-label={picker?'Choose saved place in Apple Maps':'Open interactive Apple journey map'} disabled={busy||!appleMapsAvailable()} onClick={open}>{!embedded&&preview&&<img src={preview} alt="Apple map preview"/>}<span className="apple-map-attribution">Apple Maps</span>{!embedded&&<span className="apple-map-open">{busy?'Opening…':picker?'Choose location':'Explore map'} <Maximize2 size={16} strokeWidth={1.8} aria-hidden="true"/></span>}{!preview&&<span className="apple-map-placeholder">{appleMapsAvailable()?'Apple Maps':'Maps are available in the iPhone app.'}</span>}</button>{frozen&&(!dynamic||frozen.content===latestContent)&&<img className="apple-map-freeze" src={frozen.src} alt="" aria-hidden="true" style={{height:`${frozen.height}px`}}/>}{controls&&!embedded&&<MapControls controls={controls} onAction={onControl}/>}{overviewFailed&&overviewFailed===overviewKey&&<div className="notice map-overview-error" role="alert"><span>Routes could not be drawn on the map.</span><button type="button" className="text-button" onClick={()=>{resent.current.delete(overviewKey);forgetOverview(overviewKey);setOverviewFailed(null);setOverviewAttempt(value=>value+1);}}>Retry</button></div>}{onLocate&&!embedded&&<button type="button" className="map-locate-button" aria-label="Show my location" title="Show my location" aria-pressed={locating||(basePayload.camera?.mode==='person'&&basePayload.camera?.personId==='self')} disabled={locating} onClick={onLocate}><Navigation size={20}/></button>}{!embedded&&!appleMapsAvailable()&&<PeopleActivityFallback pins={latestContent.pins}/>} {error&&<p role="status" className="notice">{error}</p>}</div>;
}

function PeopleActivityFallback({pins=[]}){
 const icons={walking:Footprints,running:Activity,cycling:Bike,driving:Car};
 const members=pins.filter(p=>p.kind==='people').flatMap(p=>p.members||[]);
 if(!members.length)return null;
 return <ul aria-label="People on the map">{members.map(member=>{const Icon=member.state==='live'?icons[member.activity]:null;return <li key={member.id}>{Icon&&<Icon size={18} aria-label={member.activity}/>} {member.name}{Icon?` · ${member.activity}`:''}</li>;})}</ul>;
}
