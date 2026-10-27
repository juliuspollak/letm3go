import PersonAvatar from './components/PersonAvatar.jsx';
import Friends from './components/Friends.jsx';
import FriendTrips from './components/FriendTrips.jsx';
import HouseholdTrips from './components/HouseholdTrips.jsx';
import {useHouseholdPresence} from './lib/useHouseholdPresence.js';
import {useFriendLocations} from './lib/useFriendLocations.js';
import HouseholdPresence from './components/HouseholdPresence.jsx';
import {useFleetJourneys} from './lib/useFleetJourneys.js';
import {useJourneyGrouping} from './lib/useJourneyGrouping.js';
import JourneyGroupingPanel from './components/JourneyGroupingPanel.jsx';
import GroupedJourneyDetail from './components/GroupedJourneyDetail.jsx';
import AnimatedWordmark from './components/AnimatedWordmark.jsx';
import AutoCloudSync from './components/AutoCloudSync.jsx';
import {distanceText,distanceValue,distanceUnitLabel} from './lib/distanceUnits.js';
import { setNativeAppearance } from './lib/appleMaps.js';
import TrackingPermissions from './components/TrackingPermissions.jsx';
import BrandMark from './components/BrandMark.jsx';
import DismissibleSheet from './components/DismissibleSheet.jsx';
import PrivateImage from './components/PrivateImage.jsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import {Archive, ListChecks, Clock3, CircleDot, Users, Gauge, Car as CarIcon, ArrowUpRight, ArrowLeft, ArrowRight, Star, ChevronRight, Footprints, Home, Map, MapPin, Mountain, Plus, Search, ShieldCheck, SlidersHorizontal, Sun, Moon, User, X, Bike, Car, Waves, Route, Lock, GitMerge, EyeOff, Eye } from 'lucide-react';
import JourneyMap from './components/JourneyMap.jsx';
import RecorderPanel from './components/RecorderPanel.jsx';
import Diagnostics from './components/Diagnostics.jsx';
import Garage from './components/Garage.jsx';
import Places from './components/Places.jsx';
import ActivityDetail from './components/ActivityDetail.jsx';
import ActivityEditor from './components/ActivityEditor.jsx';
import PublicJourney from './components/PublicJourney.jsx';
import { AuthProvider, useAuth } from './lib/AuthContext.jsx';
import AuthScreen from './components/AuthScreen.jsx';
import Onboarding from './components/Onboarding.jsx';
import AccountSettings from './components/AccountSettings.jsx';
import Household from './components/Household.jsx';
import { useRecorder } from './lib/useRecorder.js';
import { recordedJourney } from './lib/recorder.js';
const activities=['All activities','Unknown','Cycling','MTB','Hiking','Mountain biking','Walking','Running','Road cycling','Kitesurfing','Driving','Other'];
function ActivityIcon({activity,...props}) { const Icon=activity?.toLowerCase().includes('biking')||activity?.toLowerCase().includes('cycling')||activity==='MTB'?Bike:activity==='Driving'?Car:activity==='Kitesurfing'?Waves:activity==='Hiking'?Mountain:Footprints;return <Icon {...props}/>; }
export default function App(){
 useEffect(()=>{const theme=localStorage.getItem('letm3go-theme')==='dark'?'dark':'light';document.documentElement.dataset.theme=theme;void setNativeAppearance(theme).catch(()=>{});},[]);
 const token=new URLSearchParams(window.location.search).get('journey');
 return token?<PublicJourney token={token}/>:<AuthProvider><AuthGate/></AuthProvider>;
}
function AuthGate(){
 const auth=useAuth();
 if(['restoring','deleting'].includes(auth.status))return <main className="auth-loading"><span className="auth-wordmark">letm<span>3</span>go<BrandMark/></span><p role="status">{auth.status==='deleting'?'Deleting your account securely…':'Restoring your private world…'}</p></main>;
 if(!['authenticated','offline'].includes(auth.status)||auth.recovery)return <AuthScreen/>;
 if(!auth.preferences.onboardingComplete)return <>{(auth.error||auth.integrationWarning)&&<p className="notice" role="alert">{auth.error||auth.integrationWarning}</p>}<Onboarding/></>;
 return <>{(auth.error||auth.integrationWarning)&&<p className="notice" role="alert">{auth.error||auth.integrationWarning}</p>}<PrivateApp key={auth.session.user.id}/></>;
}
function PrivateApp(){
 const auth=useAuth();
 const session=auth.session;
 const unit=auth.preferences.distanceUnit||'km';
 const saved=auth.preferences.bookmarks||[];
 const recording=useRecorder(session.user.id);
 const liveTrip=recording.state.active?.state==='recording'?recording.state.active:recording.state.automaticTrip;
 const [motionClock,setMotionClock]=useState(()=>Date.now());
 useEffect(()=>{
  const updateClock=()=>setMotionClock(Date.now());
  const interval=setInterval(updateClock,15000);
  document.addEventListener('visibilitychange',updateClock);
  return()=>{clearInterval(interval);document.removeEventListener('visibilitychange',updateClock);};
 },[]);
 const motionFresh=Number.isFinite(recording.state.motionTimestamp)&&Math.abs(motionClock/1000-recording.state.motionTimestamp)<=45&&recording.state.motionConfidence!=='low';
 const motionTypes=motionFresh?recording.state.motionTypes||[]:[];
 const automaticPresenceActivity=liveTrip?.activity==='Driving'?'Driving':
  motionTypes.includes('Driving')?'Driving':
  liveTrip?.activity==='Running'||motionTypes.includes('Running')?'Running':
  ['Cycling','Road cycling','MTB'].includes(liveTrip?.activity)||motionTypes.includes('Cycling')?'Cycling':
  ['Walking','Hiking'].includes(liveTrip?.activity)||motionTypes.includes('Walking')?'Walking':
  liveTrip?'On the move':null;
 const presence=useHouseholdPresence(session.user.id,auth.status==='authenticated',automaticPresenceActivity,recording.state.places||[]);
 const friendsLocation=useFriendLocations(session.user.id,auth.status==='authenticated');
 const presenceHidden=presence.self?.sharing_enabled!==true;
 const [presenceBusy,setPresenceBusy]=useState(false);
 const [photoZoom,setPhotoZoom]=useState(1);
 const photoPinch=useRef(null);
 const togglePresence=async()=>{
  setPresenceBusy(true);
  try{await presence.update(presenceHidden);}
  catch(e){setError(e.message||'Visibility could not be changed.');}
  finally{setPresenceBusy(false);}
 };
 const fleet=useFleetJourneys(session.user.id,true);
 const grouping=useJourneyGrouping({owner:session.user.id,activities:recording.state.ownerID&&recording.state.ownerID.toLowerCase()!==session.user.id.toLowerCase()?[]:recording.state.trips.filter(t=>t.source==='device').map(recordedJourney).concat(fleet.activities),telemetry:fleet.charges,places:recording.state.places||[],vehicles:auth.preferences.vehicles||[],serialized:auth.preferences.journeyGrouping,savePreferences:auth.savePreferences});
 const [currentPosition,setCurrentPosition]=useState(null);
 const vehicles=auth.preferences.vehicles||[];
 const setVehicles=vehicles=>auth.savePreferences({vehicles});
 const realJourneys=recording.state.trips.filter(t=>t.source==='device').map(recordedJourney);
 const [draggingTrip,setDraggingTrip]=useState(null),[mergeSource,setMergeSource]=useState(null),[mergeTarget,setMergeTarget]=useState(null),[dropTarget,setDropTarget]=useState(null);
 const archiveKey='letm3go:archived-trips:'+session.user.id;
 const [archivedTrips,setArchivedTrips]=useState(()=>{try{return JSON.parse(localStorage.getItem(archiveKey)||'[]');}catch{return [];}});
 const [showArchived,setShowArchived]=useState(false);
 const [lastArchived,setLastArchived]=useState(null);
 const [swipedTrip,setSwipedTrip]=useState(null);
 const [deleteTrip,setDeleteTrip]=useState(null);
 const swipeTouch=useRef(null);
 const touchMerge=useRef(null);
 const touchDropTarget=useRef(null);
 const touchTimer=useRef(null);
 const suppressTripClick=useRef(false);
 const [floatingTrip,setFloatingTrip]=useState(null);
 const [touchPoint,setTouchPoint]=useState(null);
 const cancelTouchMerge=()=>{
  touchDropTarget.current=null;
  clearTimeout(touchTimer.current);touchTimer.current=null;touchMerge.current=null;
  setFloatingTrip(null);setTouchPoint(null);setDropTarget(null);
 };
 useEffect(()=>()=>clearTimeout(touchTimer.current),[]);
 useEffect(()=>{
  if(!floatingTrip)return;
  const blockScroll=e=>{if(e.cancelable)e.preventDefault();};
  document.addEventListener("touchmove",blockScroll,{passive:false});
  return ()=>document.removeEventListener("touchmove",blockScroll);
 },[floatingTrip]);
 const archiveTrip=trip=>{
  setArchivedTrips(old=>{const next=[...new Set([...old,trip.id])];localStorage.setItem(archiveKey,JSON.stringify(next));return next;});
  setLastArchived(trip);setSwipedTrip(null);
 };
 const restoreTrip=id=>{
  setArchivedTrips(old=>{const next=old.filter(x=>x!==id);localStorage.setItem(archiveKey,JSON.stringify(next));return next;});
  setLastArchived(null);setSwipedTrip(null);setShowArchived(false);
 };
 const startRowTouch=(e,t)=>{
  if(e.touches.length!==1)return;
  const p=e.touches[0];swipeTouch.current={id:t.id,x:p.clientX,y:p.clientY,dx:0,axis:null};
  touchStartMerge(e,t);
 };
 const moveRowTouch=e=>{
  const gesture=swipeTouch.current;
  if(!gesture||e.touches.length!==1){touchMoveMerge(e);return;}
  const p=e.touches[0],dx=p.clientX-gesture.x,dy=p.clientY-gesture.y;
  if(!gesture.axis&&Math.max(Math.abs(dx),Math.abs(dy))>10)gesture.axis=Math.abs(dx)>Math.abs(dy)*1.25?'horizontal':'vertical';
  if(gesture.axis==='horizontal'){
   gesture.dx=dx;
   cancelTouchMerge();
   if(e.cancelable)e.preventDefault();
   // Realtime row translation is applied directly to the active swipe surface.
   const surface=e.currentTarget.querySelector('.trip-swipe-surface');
   if(surface)surface.style.transform=`translateX(${Math.max(-285,Math.min(0,dx-(swipedTrip===gesture.id?132:0)))}px)`;
   return;
  }
  touchMoveMerge(e);
 };
 const endRowTouch=e=>{
  const gesture=swipeTouch.current;swipeTouch.current=null;
  const surface=e.currentTarget.querySelector('.trip-swipe-surface');
  if(surface)surface.style.transform='';
  if(gesture?.axis==='horizontal'){
   suppressTripClick.current=true;
   const selectedTrip=visibleJourneys.find(t=>t.id===gesture.id);
   const full=gesture.dx< -Math.min(window.innerWidth*0.55,260);
   if(full&&selectedTrip){archiveTrip(selectedTrip);}
   else if(gesture.dx< -55)setSwipedTrip(gesture.id);
   else if(gesture.dx>45)setSwipedTrip(null);
   setTimeout(()=>{suppressTripClick.current=false;},350);
   return;
  }
  touchEndMerge();
 };
 async function confirmTripDelete(){
  if(!deleteTrip||recording.busy||!['device','simulator'].includes(deleteTrip.source)||deleteTrip.isGroupedJourney)return;
  const result=await recording.run('deleteActivity',deleteTrip.id);
  if(result){setDeleteTrip(null);setSwipedTrip(null);setSelected(null);}
 }
 const touchStartMerge=(event,trip)=>{
  if(!canMergeRow(trip)||event.touches.length!==1||mergeTarget)return;
  const t=event.touches[0],origin={x:t.clientX,y:t.clientY};
  clearTimeout(touchTimer.current);
  touchMerge.current={id:trip.id,origin,active:false};
  touchTimer.current=setTimeout(()=>{
   if(!touchMerge.current||touchMerge.current.id!==trip.id)return;
   touchMerge.current.active=true;
   suppressTripClick.current=true;
   setFloatingTrip({id:trip.id,title:trip.title,activity:trip.activity,distance:trip.distance});
   setTouchPoint(origin);
   setMergeSource(trip.id);
  },360);
 };
 const touchMoveMerge=event=>{
  const m=touchMerge.current;if(!m||event.touches.length!==1)return;
  const t=event.touches[0],x=t.clientX,y=t.clientY;
  if(!m.active){
   if(Math.hypot(x-m.origin.x,y-m.origin.y)>9)cancelTouchMerge();
   return;
  }
  event.preventDefault();
  setTouchPoint({x,y});
  const row=document.elementFromPoint(x,y)?.closest('[data-merge-id]');
  const id=row?.dataset.mergeId;
  touchDropTarget.current=id&&id!==m.id?id:null;
  setDropTarget(touchDropTarget.current);
 };
 const touchEndMerge=()=>{
  const m=touchMerge.current, target=touchDropTarget.current;
  if(m?.active&&target&&target!==m.id){setMergeSource(m.id);setMergeTarget(target);}
  cancelTouchMerge();
  if(m?.active)setTimeout(()=>{suppressTripClick.current=false;},400);
 };
 const [metricView,setMetricView]=useState(null);
 const [socialSection,setSocialSection]=useState('friends');
 const [pendingInvitation,setPendingInvitation]=useState(()=>{try{return JSON.parse(sessionStorage.getItem('letm3go:pending-invitation')||'null');}catch{return null;}});
 const [mapLayer,setMapLayer]=useState('people');
 const [mapLayersOpen,setMapLayersOpen]=useState(false);
 const [tripSearchOpen,setTripSearchOpen]=useState(false);
 const [tripFiltersOpen,setTripFiltersOpen]=useState(false);
 const [tripActionsOpen,setTripActionsOpen]=useState(false);
 const tripSearchRef=useRef(null);

 const [tab,setTab]=useState('Home'),[selected,setSelected]=useState(null),[sheet,setSheet]=useState(null),[query,setQuery]=useState(''),[filter,setFilter]=useState('All activities'),[dayFilter,setDayFilter]=useState('all'),[sortPreference,setSortPreference]=useState(()=>{const saved=localStorage.getItem('letm3go-trip-sort');return ['newest','distance','duration'].includes(saved)?saved:'newest';}),[favouritesOnly,setFavouritesOnly]=useState(false),[error,setError]=useState(''),[lightbox,setLightbox]=useState(null),[theme,setTheme]=useState(()=>localStorage.getItem('letm3go-theme')||'light');
 useEffect(()=>{
  const opened=event=>{const invite=event.detail;if(!invite||!['friend','household'].includes(invite.kind))return;setPendingInvitation(invite);setSocialSection(invite.kind==='household'?'household':'friends');setTab('Social');};
  window.addEventListener('letm3go:invitation-opened',opened);
  return()=>window.removeEventListener('letm3go:invitation-opened',opened);
 },[]);
 useEffect(()=>{if(pendingInvitation){queueMicrotask(()=>{setSocialSection(pendingInvitation.kind==='household'?'household':'friends');setTab('Social');});}},[pendingInvitation]);
 const consumeInvitation=()=>{setPendingInvitation(null);try{sessionStorage.removeItem('letm3go:pending-invitation');}catch{/* Storage may be unavailable; in-memory invitation is cleared. */}};

 useEffect(()=>{if(tab==='Trips'&&tripSearchOpen)tripSearchRef.current?.focus();},[tab,tripSearchOpen]);
 useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem('letm3go-theme',theme);void setNativeAppearance(theme).catch(()=>{});window.dispatchEvent(new Event('letm3go:theme-changed'));},[theme]);
 useEffect(()=>{
  if(!sheet&&!lightbox)return;
  const previous=document.activeElement, overflow=document.body.style.overflow;
  document.body.style.overflow='hidden';
  const dialog=document.querySelector('.lightbox, .sheet');
  dialog?.querySelector('button, input')?.focus();
  function keydown(e){
   if(e.key==='Escape'){setLightbox(null);setSheet(null);}
   if(e.key==='Tab'){
    const nodes=[...dialog.querySelectorAll('button:not(:disabled), input, select, textarea, a[href]')];
    const first=nodes[0], last=nodes.at(-1);
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
   }
  }
  document.addEventListener('keydown',keydown);
  return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',keydown);previous?.focus();};
 },[sheet,lightbox]);
 const openPhoto=useCallback((trip,id)=>{const index=trip.photos?.findIndex(p=>p.id===id)??-1;if(index>=0){setPhotoZoom(1);setLightbox({trip,index});}},[setLightbox]);
 async function bookmark(id){const next=saved.includes(id)?saved.filter(x=>x!==id):[...saved,id];try{await auth.savePreferences({bookmarks:next});}catch(err){setError(err.message||'Favourite could not be saved.');}}
 const sort=metricView==="Today's distance"?'distance':metricView==='Recorded time'?'duration':metricView==='Activities today'?'newest':sortPreference;
 const visibleJourneys=grouping.journeys;
 const selectedJourney=selected?.isGroupedJourney?visibleJourneys.find(j=>j.id===selected.id):null;
 const selectedActivity=selected&&!selected.isGroupedJourney?(visibleJourneys.find(j=>j.id===selected.id)||realJourneys.find(j=>j.id===selected.id)||selected):null;
 const today=new Date().toLocaleDateString('en-CA');
 const shiftDay=(day,offset)=>{const basis=day==='all'||day==='today'?new Date():new Date(day+'T12:00:00');basis.setDate(basis.getDate()+offset);return basis.toLocaleDateString('en-CA');};
 const chosenDay=dayFilter==='today'?today:dayFilter;
 const filtered=visibleJourneys.filter(t=>(showArchived?archivedTrips.includes(t.id):!archivedTrips.includes(t.id))&&(!favouritesOnly||saved.includes(t.id))&&((tripSearchOpen&&query.trim())||dayFilter==='all'||t.date===chosenDay||t.segments?.some(s=>s.date===chosenDay))&&(filter==='All activities'||t.activity===filter)&&`${t.searchIndex||''} ${t.title} ${t.location} ${t.date} ${t.collection||''} ${t.notes||''} ${t.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>sort==='duration'?b.durationSeconds-a.durationSeconds||b.startedAt-a.startedAt:sort==='distance'?b.distanceMeters-a.distanceMeters||b.startedAt-a.startedAt:b.startedAt-a.startedAt);
 const matchReason=t=>{const q=query.trim().toLowerCase();if(!q)return null;const stops=t.stops||t.recognisedStops||[];const tags=(t.tags||[]).filter(tag=>tag.toLowerCase().includes(q));if(tags.length)return {label:'Matched tag',value:tags[0]};const stop=stops.find(x=>[x.name,...(x.tags||[])].some(v=>v?.toLowerCase().includes(q)));if(stop)return {label:'Matched stop',value:stop.name};for(const [label,value] of [['Title',t.title],['Location',t.location],['Notes',t.notes],['Collection',t.collection],['Date',t.date]])if(value?.toLowerCase().includes(q))return {label:'Matched '+label.toLowerCase(),value};return {label:'Matched trip details',value:q};};
 const canMergeRow=t=>!t.readOnly&&(t.isGroupedJourney||t.endedAt!=null&&t.state!=='recording')&&(t.isGroupedJourney||t.source==='device');
 const confirmMerge=async()=>{
  if(!mergeSource||!mergeTarget)return;
  const expand=id=>{const trip=grouping.journeys.find(t=>t.id===id);return trip?.isGroupedJourney?trip.segmentIDs:[id];};
  const pair=[...new Set([...expand(mergeSource),...expand(mergeTarget)])];
  const success=await grouping.act({type:'merge',ids:pair});
  if(success){setMergeSource(null);setMergeTarget(null);setDropTarget(null);}
 };
 const todayJourneys=grouping.records.filter(t=>t.date===today);
 const total=todayJourneys.reduce((n,t)=>n+t.distance,0);
 const minutes=Math.floor(todayJourneys.reduce((n,t)=>n+t.durationSeconds,0)/60);
 return <><AutoCloudSync state={recording.state}/><div className="app-shell"><aside className="desktop-rail"><a className="brand" href="#" onClick={e=>{e.preventDefault();setSelected(null);setTab('Home');}} aria-label="Letm3go Home"><AnimatedWordmark/></a><p className="rail-caption">MAKE ROOM FOR ADVENTURE</p><nav>{[[Home,'Home'],[Map,'Map'],[CircleDot,'Record'],[Route,'Trips'],[Users,'Social']].map(([Icon,name])=><button key={name} className={tab===name&&!selected?'active':''} onClick={()=>{setTab(name);setSelected(null);}}><Icon size={21}/>{name}</button>)}</nav><div className="rail-bottom"><div className="private-note"><ShieldCheck size={22}/><strong>Your story. Your choice.</strong><p>Your journeys are private until you choose to share.</p></div><button className="profile-link" onClick={()=>setSheet('profile')}><span className="avatar"><User size={20}/></span><div><strong>{session?'Your account':'Your adventure starts here'}</strong><small>{session?'Manage profile':'Private local activities'}</small></div><ChevronRight size={16}/></button></div></aside>
 <main>{error&&<p role="alert" className="error">{error}</p>}{auth.status==='offline'&&<p className="notice">Offline · Private recordings stay on this device. Cloud actions require reconnection.</p>}<header className="topbar"><span className="mobile-brand"><AnimatedWordmark/></span><div className="breadcrumb">Your world, a little closer.</div><div className="top-actions"><button className="icon-button" aria-label="Toggle dark theme" onClick={()=>setTheme(theme==='dark'?'light':'dark')}>{theme==='dark'?<Sun size={20}/>:<Moon size={20}/>}</button><button type="button" className={`icon-button presence-toggle ${presenceHidden?'presence-hidden':'presence-visible'}`} aria-label={presenceHidden?'Hidden. Enable household status sharing':'Visible to household. Hide your status'} aria-pressed={presenceHidden} title={presenceHidden?'Hidden — not sharing':'Visible — household status sharing enabled'} disabled={presenceBusy||presence.busy||auth.status!=='authenticated'||!!presence.error} onClick={togglePresence}>{presenceHidden?<EyeOff size={20}/>:<Eye size={20}/>}</button><button className="avatar" aria-label="Open profile" onClick={()=>setSheet('profile')}>{auth.preferences.avatar?<img className="avatar" src={auth.preferences.avatar} alt="Your profile"/>:<User size={20}/>}</button></div></header>
 {recording.state.active&&<button type="button" className="active-recording-banner" onClick={()=>{setSelected(null);setSheet(null);setTab("Record");}} aria-label="Return to active recording"><span className="live-dot"/><strong>{recording.state.active.activity} · {recording.state.active.state==="recording"?"Recording": "Paused"}</strong><span>Continue exploring · tap to view recording</span><ArrowRight size={17}/></button>}
 {selectedJourney?<GroupedJourneyDetail unit={unit} key={selectedJourney.id} trip={selectedJourney} grouping={grouping} activities={realJourneys} places={recording.state.places||[]} recording={recording} onBack={()=>setSelected(null)} onPhoto={openPhoto} onEdit={trip=>{setSelected(trip);setSheet('nativeEdit');}}/>:selected&&!selected.isGroupedJourney?<ActivityDetail unit={unit} key={selected.id} trip={selectedActivity} onStopChange={grouping.act} grouping={grouping} onSource={setSelected} places={recording.state.places||[]} onBack={()=>setSelected(null)} onEdit={()=>setSheet('nativeEdit')} onPhoto={openPhoto} run={recording.run} onUpdated={setSelected} onDeleted={()=>setSelected(null)} busy={recording.busy} error={recording.error}/>
:<div className="page-enter">
 {tab==='Trips'?<div className="trip-journal-heading"><div><p className="eyebrow">YOUR PERSONAL JOURNAL</p><h1>Your activities</h1></div><div className="trip-heading-actions"><button type="button" className="trip-round-action" aria-label={tripSearchOpen?'Close activity search':'Search all activities'} aria-expanded={tripSearchOpen} onClick={()=>{if(tripSearchOpen)setQuery('');setTripSearchOpen(v=>!v);setTripActionsOpen(false);setDayFilter('all');}}>{tripSearchOpen?<X size={20}/>:<Search size={20}/>}</button><button type="button" className="trip-round-action" aria-label="Activity filters" aria-expanded={tripFiltersOpen} onClick={()=>{setTripFiltersOpen(v=>!v);setTripActionsOpen(false);}}><SlidersHorizontal size={20}/></button><button type="button" className="trip-round-action" aria-label="More activity actions" aria-expanded={tripActionsOpen} onClick={()=>{setTripActionsOpen(v=>!v);setTripFiltersOpen(false);}}><Plus size={21}/></button></div></div>:<div className="page-heading"><div><p className="eyebrow">{tab==='Home'?'YOUR DAY, OUT THERE':tab==='Record'?'REAL GPS · PRIVATE BY DEFAULT':tab==='Social'?'YOUR PEOPLE':'YOUR RECORDED WORLD'}</p><h1>{tab==='Home'?'Your day. Your way.':tab==='Record'?'Record an activity.':tab==='Social'?'Your people.':'Your world, mapped.'}</h1><p className="muted">{tab==='Home'?'A little movement. A little perspective. Your day at a glance.':tab==='Record'?'Start here. Keep recording with the screen locked where iOS permits.':tab==='Social'?(presence.liveEnabled||friendsLocation.enabled?'Live sharing is on. You can turn it off any time.':'Connect with people. Share live only when you choose.'):'Explore your routes and places.'}</p></div>{tab==='Home'?<button className="primary" onClick={()=>setTab('Record')}><Plus size={19}/> Start activity</button>:null}</div>}
 {tab==='Home'&&<><div className="overview home-today">{[[Route,distanceValue(total,unit),distanceUnitLabel(unit),"Today's distance",'distance','View longest trips first'],[ListChecks,todayJourneys.length,'','Activities today','newest','View newest trips first'],[Clock3,minutes,'min','Recorded time','duration','View longest durations first']].map(([Icon,value,unit,label,,hint])=><button type="button" className="home-metric" key={label} aria-label={`${label}: ${value} ${unit}. ${hint}`} onClick={()=>{setQuery('');setFilter('All activities');setDayFilter('today');setMetricView(label);setFavouritesOnly(false);setTab('Trips');}}><span className="home-metric-icon"><span className="overview-icon"><Icon size={21}/></span><ChevronRight size={14} aria-hidden="true"/></span><span><strong>{value} {unit&&<small>{unit}</small>}</strong><span className="home-metric-label">{label}</span></span></button>)}</div><div className="home-highlights">
 <section className="home-highlight-card">
  <div className="home-highlight-heading"><h2>Last activity</h2><button type="button" className="text-button" onClick={()=>{setTab('Trips');setMetricView(null);setDayFilter('all');}}>See all <ChevronRight size={15}/></button></div>
  {visibleJourneys.length?(()=>{const latest=[...visibleJourneys].sort((a,b)=>b.startedAt-a.startedAt)[0];return <button type="button" className="home-last-activity" onClick={()=>{setSelected(latest);setTab('Trips');}}><span className="overview-icon"><ActivityIcon activity={latest.activity} size={21}/></span><span className="home-last-activity-info"><strong>{latest.title}</strong><small>{new Date(latest.startedAt*1000).toLocaleDateString('en-AU',{day:'numeric',month:'short'})} · {new Date(latest.startedAt*1000).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'})}{latest.endedAt?' – '+new Date(latest.endedAt*1000).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'}):''}</small><small>{latest.activity} · {distanceText(latest.distance,unit)}</small></span><ChevronRight size={18}/></button>;})():<p className="muted small-copy">Your next recorded activity will appear here.</p>}
 </section>
 <section className="home-highlight-card">
  <div className="home-highlight-heading"><h2>Friends</h2><button type="button" className="text-button" onClick={()=>{setSocialSection('friends');setTab('Social');}}>See friends <ChevronRight size={15}/></button></div>
  {friendsLocation.people.length?<div className="home-friends-live">{friendsLocation.people.slice(0,4).map(person=><button type="button" className="home-friends-preview" key={person.user_id} onClick={()=>setTab('Social')}><PersonAvatar name={person.display_name}/><span><strong>{person.display_name}</strong><small>Last known location</small><small>Updated {new Date(person.updated_at).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'})}</small></span><ChevronRight size={16}/></button>)}</div>:<button type="button" className="home-friends-preview" onClick={()=>setTab('Social')}><span className={`home-friends-avatar ${presenceHidden?'home-presence-hidden':''}`}>{presenceHidden?<EyeOff size={21}/>:<Users size={21}/>}</span><span><strong>No recent shared statuses</strong><small>Friends who opt in appear here when their location is recent.</small><small>{friendsLocation.enabled?'You are sharing with friends':'Your friend location is not shared'}</small></span><ChevronRight size={18}/></button>}
 </section>
 </div>{!grouping.records.length&&<div className="home-welcome"><h2>Your next chapter starts here.</h2><p className="muted">No device recordings yet.</p><p>Enable automatic tracking or start an activity. Your history will appear in Trips, and your routes in Map.</p></div>}</>}
 {tab==='Record'&&<RecorderPanel state={recording.state} run={recording.run} busy={recording.busy} error={recording.error} vehicles={vehicles} onFinished={trip=>{setSelected(trip);setTab('Trips');}}/>}
 {tab==='Trips'&&<>{fleet.error&&vehicles.some(v=>v.source==='tesla')&&<p role="status" className="notice">{fleet.error}</p>}{fleet.more&&<button className="text-button" disabled={fleet.loadingMore} onClick={fleet.loadMore}>{fleet.loadingMore?'Loading…':'Load older Tesla journeys'}</button>}{tripActionsOpen&&<div className="trip-popover" role="group" aria-label="Activity actions"><button type="button" onClick={()=>{setSheet('historical');setTripActionsOpen(false);}}><Plus size={17}/> Add past activity</button><button type="button" onClick={()=>{setSheet('grouping');setTripActionsOpen(false);}}><GitMerge size={17}/> Manage merged journeys</button>{grouping.metadata.history?.length>0&&<button type="button" disabled={grouping.busy} onClick={()=>{grouping.act({type:'undo'});setTripActionsOpen(false);}}>Undo last grouping change</button>}</div>}
{lastArchived&&<div className="trip-archive-toast" role="status"><span>Archived “{lastArchived.title}”</span><button type="button" onClick={()=>restoreTrip(lastArchived.id)}>Undo</button></div>}
{(archivedTrips.length>0||showArchived)&&<button type="button" className="trip-archived-toggle" onClick={()=>{setShowArchived(v=>!v);setSwipedTrip(null);setLastArchived(null);}}>{showArchived?'Back to activities':`Archived activities (${archivedTrips.length})`}</button>}
{tripSearchOpen&&<div className="trip-expanded-search"><Search size={19}/><input ref={tripSearchRef} type="search" aria-label="Search all activity history" placeholder="Search places, activities, tags, dates…" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button type="button" aria-label="Clear search" onClick={()=>setQuery('')}><X size={18}/></button>}</div>}
{tripFiltersOpen&&<div className="trip-expanded-filters"><label>Activity type<select aria-label="Filter activities" value={filter} onChange={e=>setFilter(e.target.value)}>{activities.map(a=><option key={a}>{a}</option>)}</select></label><label>Sort by<select aria-label="Sort trips" value={sort} onChange={event=>{setSortPreference(event.target.value);localStorage.setItem('letm3go-trip-sort',event.target.value);setMetricView(null);}}><option value="newest">Newest</option><option value="distance">Distance</option><option value="duration">Duration</option></select></label></div>}
{mergeSource&&<div className="trip-merge-hint">Select a second drive to merge. <button type="button" className="text-button" onClick={()=>{setMergeSource(null);setMergeTarget(null);}}>Cancel</button></div>}
<div className="trip-compact-navigation"><div className="trip-period-filter" role="group" aria-label="Activity date"><button type="button" aria-pressed={dayFilter==='all'} onClick={()=>setDayFilter('all')}>All</button><button type="button" aria-pressed={dayFilter==='today'} onClick={()=>setDayFilter('today')}>Today</button><button type="button" aria-pressed={favouritesOnly} onClick={()=>setFavouritesOnly(value=>!value)}><Star size={14} aria-hidden="true"/> Favourites</button></div><div className="trip-date-navigator" role="group" aria-label="Browse journey dates"><button type="button" aria-label="Previous day" onClick={()=>setDayFilter(shiftDay(chosenDay,-1))}><ChevronRight className="trip-prev-icon" size={18}/></button><label><input type="date" aria-label="Choose journey date" value={chosenDay==='all'?today:chosenDay} max={today} onChange={e=>{if(e.target.value)setDayFilter(e.target.value);}}/></label><button type="button" aria-label="Next day" disabled={chosenDay==='all'||chosenDay>=today} onClick={()=>setDayFilter(shiftDay(chosenDay,1))}><ChevronRight size={18}/></button></div></div>
<div className="section-heading trip-results-heading"><div><h2>{filtered.length} {filtered.length===1?'activity':'activities'}</h2><p className="muted small-copy">{dayFilter==='today'?'Today · ':dayFilter!=='all'?`${new Date(chosenDay+'T12:00:00').toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'})} · `:''}{sort==='duration'?`${Math.floor(filtered.reduce((sum,t)=>sum+t.durationSeconds,0)/60)} min recorded · Longest first`:sort==='distance'?`${distanceText(filtered.reduce((sum,t)=>sum+t.distanceMeters,0)/1000,unit)} total · Longest first`:'Newest first'}</p></div></div><div className="recent-activities trips-activity-list">{filtered.map(t=><div data-merge-id={canMergeRow(t)?t.id:undefined} onTouchStart={e=>startRowTouch(e,t)} onTouchMove={moveRowTouch} onTouchEnd={endRowTouch} onTouchCancel={()=>{swipeTouch.current=null;cancelTouchMerge();}} className={`trip-list-row ${dropTarget===t.id?'merge-drop-target':''} ${draggingTrip===t.id?'merge-dragging':''} ${swipedTrip===t.id?'trip-swiped':''}`} key={t.id}
 draggable={canMergeRow(t)&&!grouping.busy}
 onDragStart={e=>{if(!canMergeRow(t))return;e.dataTransfer.setData('text/plain',t.id);e.dataTransfer.effectAllowed='move';setMergeSource(t.id);setDraggingTrip(t.id);}}
 onDragOver={e=>{if(canMergeRow(t)&&mergeSource&&mergeSource!==t.id){e.preventDefault();e.dataTransfer.dropEffect='move';setDropTarget(t.id);}}}
 onDragLeave={()=>{if(dropTarget===t.id)setDropTarget(null);}}
 onDrop={e=>{e.preventDefault();const source=e.dataTransfer.getData('text/plain')||mergeSource;setDropTarget(null);setDraggingTrip(null);if(source&&source!==t.id&&canMergeRow(t)){setMergeSource(source);setMergeTarget(t.id);}}}
 onDragEnd={()=>{setDropTarget(null);setDraggingTrip(null);}}><div className="trip-swipe-actions">
 
 <button type="button" className="trip-action-pin" onClick={()=>void bookmark(t.id)} aria-label={saved.includes(t.id)?`Unpin ${t.title}`:`Pin ${t.title}`}><Star size={20} fill={saved.includes(t.id)?'white':'none'}/><small>{saved.includes(t.id)?'Unpin':'Pin'}</small></button>
 <button type="button" className="trip-action-archive" onClick={()=>showArchived?restoreTrip(t.id):archiveTrip(t)}><Archive size={20}/><small>{showArchived?'Restore':'Archive'}</small></button>
 </div><div className="trip-swipe-surface" style={{transform:swipedTrip===t.id?'translateX(-132px)':undefined}}><button type="button" className="recent-activity-row" onClick={()=>{if(suppressTripClick.current){suppressTripClick.current=false;return;}setSelected(t);}} aria-label={`Open ${t.title}`}><span className="recent-activity-icon"><ActivityIcon activity={t.activity} size={19}/></span><span className="recent-activity-info"><strong>{t.title}</strong><small>{t.isGroupedJourney?`${t.segmentIDs.length} activities · ${t.stops.length} stops`:t.activity} · {new Date(`${t.date}T12:00:00`).toLocaleDateString('en-AU',{day:'numeric',month:'short'})}</small>{query.trim()&&matchReason(t)&&<small className="trip-search-reason"><Search size={12}/>{matchReason(t).label}: <strong>{matchReason(t).value}</strong></small>}<small>{new Date(t.startedAt*1000).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'})} – {t.endedAt!=null?new Date(t.endedAt*1000).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'}):'Recording'}</small></span><span className="recent-activity-distance">{sort==='duration'?<>{Math.floor(t.durationSeconds/60)} <small>min</small><small className="trip-time-distance">{distanceText(t.distance,unit)}</small></>:<>{distanceValue(t.distance,unit)} <small>{distanceUnitLabel(unit)}</small></>}</span><ChevronRight size={16} aria-hidden="true"/></button><button type="button" className="icon-button trip-row-bookmark" aria-pressed={saved.includes(t.id)} title={saved.includes(t.id)?'Remove from favourites':'Add to favourites'} aria-label={`${saved.includes(t.id)?'Remove from':'Add to'} favourites: ${t.title}`} onClick={()=>bookmark(t.id)}><Star size={17} fill={saved.includes(t.id)?'currentColor':'none'}/></button>{canMergeRow(t)&&<button type="button" className="text-button trip-merge-button" disabled={grouping.busy} onClick={()=>{if(mergeSource&&mergeSource!==t.id){setMergeTarget(t.id);}else{setMergeSource(t.id);setMergeTarget(null);}}} aria-label={mergeSource&&mergeSource!==t.id?`Merge with ${t.title}`:`Select ${t.title} to merge`} title={mergeSource&&mergeSource!==t.id?'Merge with this drive':mergeSource===t.id?'Selected for merging':'Merge with another drive'}><GitMerge size={17} aria-hidden="true"/></button>}</div></div>)}</div>{deleteTrip&&<div className="trip-delete-confirm" role="dialog" aria-label="Delete activity"><strong>Delete {deleteTrip.title}?</strong><p>This permanently removes the local activity and its saved route. Original photos in your library remain.</p><div className="detail-actions"><button type="button" className="secondary" onClick={()=>setDeleteTrip(null)}>Cancel</button><button type="button" className="primary" disabled={recording.busy} onClick={()=>void confirmTripDelete()}>Delete activity</button></div></div>}{!filtered.length&&<div className="empty"><Search/><h2>No journeys found</h2><p>Try a different place, date or activity.</p><button className="secondary" onClick={()=>{setQuery('');setFilter('All activities');setDayFilter('all');setFavouritesOnly(false);}}>Clear filters</button></div>}</>}
 {floatingTrip&&touchPoint&&<div className="merge-floating-card" style={{left:touchPoint.x,top:touchPoint.y}} aria-hidden="true"><span className="merge-floating-icon"><ActivityIcon activity={floatingTrip.activity} size={20}/></span><span className="merge-floating-copy"><strong>{floatingTrip.title}</strong><small>{distanceText(floatingTrip.distance,unit)} · Drop on another drive</small></span></div>}
 {mergeSource&&mergeTarget&&<div className="modal-backdrop" role="presentation"><div className="notice" role="dialog" aria-modal="true" aria-label="Merge journeys" style={{maxWidth:440,margin:'auto',padding:24}}><h2>Merge these activities?</h2><p>Combine the two selected journeys into one timeline while retaining the original GPS recordings and stops. You can undo this later.</p><p className="muted small-copy">Only consecutive activities from the same account can be merged; overlapping recordings and incompatible vehicles are excluded.</p>{grouping.error&&<p role="alert" className="error">{grouping.error}</p>}<div className="detail-actions"><button className="secondary" onClick={()=>{setMergeTarget(null);setMergeSource(null);}}>Cancel</button><button className="primary" disabled={grouping.busy} onClick={confirmMerge}>{grouping.busy?'Merging…':'Yes, merge'}</button></div></div></div>}
 {tab==='Social'&&<div className="social-layout social-redesign"><div className="social-sections" role="group" aria-label="Social sections"><button type="button" aria-pressed={socialSection==='friends'} onClick={()=>setSocialSection('friends')}>Friends</button><button type="button" aria-pressed={socialSection==='household'} onClick={()=>setSocialSection('household')}>Household</button></div>{socialSection==='friends'?<><HouseholdPresence householdLivePeople={presence.livePeople} householdLiveEnabled={presence.liveEnabled} selfAvatar={auth.preferences.avatar} selfName={auth.preferences.displayName||'You'} presence={presence} friendsLocation={friendsLocation} places={recording.state.places||[]} onSetHome={()=>setSheet('places')}/><Friends invitationCode={pendingInvitation?.kind==='friend'?pendingInvitation.code:null} onInviteConsumed={consumeInvitation} onShareLive={()=>friendsLocation.setSharing(true)}/><FriendTrips activities={grouping.journeys}/></>:<><Household invitationCode={pendingInvitation?.kind==='household'?pendingInvitation.code:null} onInviteConsumed={consumeInvitation} profileAvatar={auth.preferences.avatar} onShareLive={()=>presence.setLiveSharing(true)} onStopLive={()=>presence.setLiveSharing(false)} liveEnabled={presence.liveEnabled} vehicles={vehicles} onSaveVehicles={setVehicles}/><HouseholdTrips activities={grouping.records}/></>}</div>}
 {tab==='Map'&&<div className="map-explorer map-social-explorer">
 <div className="map-compact-toolbar"><span className="map-compact-label">{mapLayer==='people'?'People & places':mapLayer==='today'?'Today’s activities':mapLayer==='pinned'?'Favourite activities':'All activities'}</span><button type="button" className="map-layers-trigger" aria-expanded={mapLayersOpen} aria-label="Choose map layers" onClick={()=>setMapLayersOpen(v=>!v)}><SlidersHorizontal size={18}/> Layers</button></div>
 {mapLayersOpen&&<div className="map-layer-popover" role="group" aria-label="Map layers">{[['people','People & places'],['today','Today’s activities'],['pinned','Favourite activities'],['all','All activities']].map(([id,label])=><button type="button" key={id} aria-pressed={mapLayer===id} onClick={()=>{setMapLayer(id);setMapLayersOpen(false);}}>{label}{mapLayer===id?' ✓':''}</button>)}</div>}
 <JourneyMap journeys={mapLayer==='people'?[]:mapLayer==='today'?grouping.journeys.filter(t=>t.date===today||t.segments?.some(seg=>seg.date===today)):mapLayer==='pinned'?grouping.journeys.filter(t=>saved.includes(t.id)||t.segmentIDs?.some(id=>saved.includes(id))):grouping.journeys} onPhoto={openPhoto} currentPosition={currentPosition} livePeople={[...friendsLocation.people.map(p=>({...p,source:'friend'})),...presence.livePeople.filter(p=>!friendsLocation.people.some(friend=>friend.user_id===p.user_id)).map(p=>({...p,source:'household'}))]} homePresence={(()=>{const home=recording.state.places?.find(p=>p.kind==='home');if(!home)return null;const names=[...(presence.self?.sharing_enabled&&presence.self?.activity_label==='At home'?['You']:[]),...presence.people.filter(p=>p.activity_label==='At home').map(p=>p.display_name)];return names.length?{latitude:home.latitude,longitude:home.longitude,count:names.length,names}:null;})()} large locating={recording.busy} onLocate={async()=>{const point=await recording.run('currentPosition');if(point){setCurrentPosition(point);setError('');}else setError('Current location is unavailable. Check permissions or try outdoors.');}}/>{realJourneys.length>50&&<p className="muted small-copy">Showing the 50 most recent routes.</p>}</div>}

 <footer className="page-footer"><span>Go somewhere. Keep the feeling.</span><span><Lock size={12}/> Your routes stay private</span></footer></div>}
 </main><nav className="mobile-nav">{[[Home,'Home'],[Map,'Map'],[CircleDot,'Record'],[Route,'Trips'],[Users,'Social']].map(([Icon,name])=><button key={name} className={tab===name?'active':''} onClick={()=>{setTab(name);setSelected(null);}}><Icon size={21}/><span>{name}</span></button>)}</nav>
 {sheet&&<div className="modal-backdrop" onClick={()=>setSheet(null)}><DismissibleSheet key={sheet} onClose={()=>setSheet(null)} label={sheet==='auth'?'Account access':sheet==='edit'?'Edit journey':sheet==='tracking'?'Tracking & Permissions':sheet==='diagnostics'?'Diagnostics':sheet==='garage'?'My Collection':sheet==='places'?'Saved places':sheet==='nativeEdit'?'Edit activity':sheet==='historical'?'Add past activity':'Your profile'}><button className="close icon-button" aria-label="Close dialog" onClick={()=>setSheet(null)}><X/></button>
 {sheet==='grouping'&&<JourneyGroupingPanel onReview={id=>{const trip=realJourneys.find(t=>t.id===id);if(trip){setSelected(trip);setSheet(null);}}} activities={realJourneys} grouping={grouping} onClose={()=>setSheet(null)}/>}
 {sheet==='profile'&&<><span className="sheet-icon"><ShieldCheck size={28}/></span><p className="eyebrow">YOUR LITTLE CORNER</p><h2>{auth.preferences.displayName||'Your private world.'}</h2><p className="muted">{session?.user.email||'Create an account to get ready for your own story.'}</p><div className="status-row"><Lock size={18}/><div><strong>Sharing & privacy</strong><p>Your routes are private. {presenceHidden?'Your social status is hidden.':'Your social status is visible to accepted friends and household members.'} Change visibility with the eye icon at the top of the app or in Social.</p></div></div><div className="status-row"><Star size={18}/><div><strong>{saved.length} favourite activities</strong><p>Favourites help you find trips again. They do not change sharing permissions.</p></div></div><div className="profile-tools"><button className="secondary full" onClick={()=>setSheet('diagnostics')}><Gauge size={17}/> Diagnostics</button><button className="secondary full" onClick={()=>setSheet('garage')}><CarIcon size={17}/> My Collection</button></div><div className="profile-tools"><button className="secondary full" onClick={()=>setSheet('places')}><MapPin size={17}/> Saved places</button></div><button className="primary full" onClick={()=>setSheet('account')}>Account & settings <ArrowRight size={18}/></button><button type="button" className="secondary full" onClick={()=>setSheet('tracking')}>Tracking & Permissions</button><button className="secondary full" onClick={()=>setSheet('household')}>Household</button><small className="muted">Your activities remain private. Household setup does not enable location sharing.</small></>}
 {sheet==='places'&&<Places places={recording.state.places||[]} run={recording.run} busy={recording.busy} error={recording.error}/>}
 {['nativeEdit','historical'].includes(sheet)&&<ActivityEditor trip={selected} vehicles={vehicles} run={recording.run} busy={recording.busy} error={recording.error} historical={sheet==='historical'} onSaved={(result,id)=>{const trip=result.trips.find(t=>t.id===id);if(trip)setSelected(recordedJourney(trip));setSheet(null);}}/>}
 {sheet==='diagnostics'&&<Diagnostics state={recording.state} session={session} preferences={auth.preferences} run={recording.run}/>}
 {sheet==='garage'&&<Garage vehicles={vehicles} onSave={setVehicles}/>}
 {sheet==='account'&&<AccountSettings recording={recording} onTracking={()=>setSheet('tracking')}/>}
 {sheet==='tracking'&&<TrackingPermissions recording={recording} onBack={()=>setSheet('account')}/>}
 {sheet==='household'&&<Household profileAvatar={auth.preferences.avatar} onShareLive={()=>presence.setLiveSharing(true)} onStopLive={()=>presence.setLiveSharing(false)} liveEnabled={presence.liveEnabled}/>}

{error&&<p role="alert" className="error">{error}</p>}</DismissibleSheet></div>}
 {lightbox&&<div className="lightbox" role="dialog" aria-modal="true" aria-label="Journey photographs" onClick={e=>{if(e.target===e.currentTarget)setLightbox(null);}}><button type="button" className="close icon-button" aria-label="Close photographs" onClick={()=>setLightbox(null)}><X/></button><div className="photo-zoom-viewport" onTouchStart={e=>{if(e.touches.length===2)photoPinch.current={distance:Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY),zoom:photoZoom};}} onTouchMove={e=>{if(e.touches.length===2&&photoPinch.current){e.preventDefault();const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);setPhotoZoom(Math.max(1,Math.min(5,photoPinch.current.zoom*d/photoPinch.current.distance)));}}} onTouchEnd={()=>{photoPinch.current=null;}}><PrivateImage className="zoomable-photo" style={{transform:`scale(${photoZoom})`}} onDoubleClick={()=>setPhotoZoom(z=>z>1?1:2)} src={lightbox.trip.photos[lightbox.index].url} alt={lightbox.trip.photos[lightbox.index].caption}/></div><div className="photo-zoom-controls"><button type="button" aria-label="Zoom out" disabled={photoZoom<=1} onClick={()=>setPhotoZoom(z=>Math.max(1,z-.5))}>−</button><span>{Math.round(photoZoom*100)}%</span><button type="button" aria-label="Zoom in" disabled={photoZoom>=5} onClick={()=>setPhotoZoom(z=>Math.min(5,z+.5))}>+</button><button type="button" onClick={()=>setPhotoZoom(1)}>Reset</button></div><p>{lightbox.trip.photos[lightbox.index].caption}</p><div><button className="icon-button" aria-label="Previous photo" disabled={lightbox.index===0} onClick={()=>{setPhotoZoom(1);setLightbox({...lightbox,index:lightbox.index-1});}}><ArrowLeft/></button><span>{lightbox.index+1} / {lightbox.trip.photos.length} · {lightbox.trip.source?'Private photo':'Demo photo'}</span><button className="icon-button" aria-label="Next photo" disabled={lightbox.index===lightbox.trip.photos.length-1} onClick={()=>{setPhotoZoom(1);setLightbox({...lightbox,index:lightbox.index+1});}}><ArrowRight/></button></div></div>}
 </div></>;
}
