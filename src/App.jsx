import {useJourneyGrouping} from './lib/useJourneyGrouping.js';
import JourneyGroupingPanel from './components/JourneyGroupingPanel.jsx';
import GroupedJourneyDetail from './components/GroupedJourneyDetail.jsx';
import AnimatedWordmark from './components/AnimatedWordmark.jsx';
import { setNativeAppearance } from './lib/appleMaps.js';
import TrackingPermissions from './components/TrackingPermissions.jsx';
import BrandMark from './components/BrandMark.jsx';
import DismissibleSheet from './components/DismissibleSheet.jsx';
import PrivateImage from './components/PrivateImage.jsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ListChecks, Clock3, CircleDot, Users, Gauge, Car as CarIcon, ArrowUpRight, ArrowLeft, ArrowRight, Star, ChevronRight, Footprints, Home, Map, MapPin, Mountain, Plus, Search, ShieldCheck, SlidersHorizontal, Sun, Moon, User, X, Bike, Car, Waves, Route, Lock } from 'lucide-react';
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
 const saved=auth.preferences.bookmarks||[];
 const recording=useRecorder(session.user.id);
 const grouping=useJourneyGrouping({owner:session.user.id,activities:recording.state.ownerID&&recording.state.ownerID.toLowerCase()!==session.user.id.toLowerCase()?[]:recording.state.trips.filter(t=>t.source==='device').map(recordedJourney),places:recording.state.places||[],vehicles:auth.preferences.vehicles||[],serialized:auth.preferences.journeyGrouping,savePreferences:auth.savePreferences});
 const [currentPosition,setCurrentPosition]=useState(null);
 const vehicles=auth.preferences.vehicles||[];
 const setVehicles=vehicles=>auth.savePreferences({vehicles});
 const realJourneys=recording.state.trips.filter(t=>t.source==='device').map(recordedJourney);
 const [draggingTrip,setDraggingTrip]=useState(null),[mergeSource,setMergeSource]=useState(null),[mergeTarget,setMergeTarget]=useState(null),[dropTarget,setDropTarget]=useState(null);
 const touchMerge=useRef(null);
 const touchTimer=useRef(null);
 const suppressTripClick=useRef(false);
 const [floatingTrip,setFloatingTrip]=useState(null);
 const [touchPoint,setTouchPoint]=useState(null);
 const cancelTouchMerge=()=>{
  clearTimeout(touchTimer.current);touchTimer.current=null;touchMerge.current=null;
  setFloatingTrip(null);setTouchPoint(null);setDropTarget(null);
 };
 useEffect(()=>()=>clearTimeout(touchTimer.current),[]);
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
  setDropTarget(id&&id!==m.id?id:null);
 };
 const touchEndMerge=()=>{
  const m=touchMerge.current, target=dropTarget;
  if(m?.active&&target&&target!==m.id){setMergeSource(m.id);setMergeTarget(target);}
  cancelTouchMerge();
 };
 const [tab,setTab]=useState('Home'),[selected,setSelected]=useState(null),[sheet,setSheet]=useState(null),[query,setQuery]=useState(''),[filter,setFilter]=useState('All activities'),[dayFilter,setDayFilter]=useState('all'),[sort,setSort]=useState('newest'),[favouritesOnly,setFavouritesOnly]=useState(false),[error,setError]=useState(''),[lightbox,setLightbox]=useState(null),[theme,setTheme]=useState(()=>localStorage.getItem('letm3go-theme')||'light');
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
 const openPhoto=useCallback((trip,id)=>setLightbox({trip,index:trip.photos.findIndex(p=>p.id===id)}),[setLightbox]);
 async function bookmark(id){const next=saved.includes(id)?saved.filter(x=>x!==id):[...saved,id];try{await auth.savePreferences({bookmarks:next});}catch(err){setError(err.message||'Favourite could not be saved.');}}
 const visibleJourneys=grouping.journeys;
 const selectedJourney=selected?.isGroupedJourney?visibleJourneys.find(j=>j.id===selected.id):null;
 const selectedActivity=selected&&!selected.isGroupedJourney?(visibleJourneys.find(j=>j.id===selected.id)||realJourneys.find(j=>j.id===selected.id)||selected):null;
 const today=new Date().toLocaleDateString('en-CA');
 const filtered=visibleJourneys.filter(t=>(!favouritesOnly||saved.includes(t.id))&&(dayFilter!=='today'||t.date===today||t.segments?.some(s=>s.date===today))&&(filter==='All activities'||t.activity===filter)&&`${t.searchIndex||''} ${t.title} ${t.location} ${t.date} ${t.collection||''} ${t.notes||''} ${t.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>sort==='duration'?b.durationSeconds-a.durationSeconds||b.startedAt-a.startedAt:sort==='distance'?b.distanceMeters-a.distanceMeters||b.startedAt-a.startedAt:b.startedAt-a.startedAt);
 const canMergeRow=t=>!t.isGroupedJourney&&t.activity==='Driving'&&t.state==='finished'&&t.source==='device';
 const confirmMerge=async()=>{
  if(!mergeSource||!mergeTarget)return;
  const pair=[mergeSource,mergeTarget];
  const success=await grouping.act({type:'merge',ids:pair});
  if(success){setMergeSource(null);setMergeTarget(null);setDropTarget(null);}
 };
 const todayJourneys=realJourneys.filter(t=>t.date===today);
 const total=todayJourneys.reduce((n,t)=>n+t.distance,0);
 const minutes=Math.floor(todayJourneys.reduce((n,t)=>n+t.durationSeconds,0)/60);
 return <div className="app-shell"><aside className="desktop-rail"><a className="brand" href="#" onClick={e=>{e.preventDefault();setSelected(null);setTab('Home');}} aria-label="Letm3go Home"><AnimatedWordmark/></a><p className="rail-caption">MAKE ROOM FOR ADVENTURE</p><nav>{[[Home,'Home'],[Map,'Map'],[CircleDot,'Record'],[Route,'Trips'],[Users,'Social']].map(([Icon,name])=><button key={name} className={tab===name&&!selected?'active':''} onClick={()=>{setTab(name);setSelected(null);}}><Icon size={21}/>{name}</button>)}</nav><div className="rail-bottom"><div className="private-note"><ShieldCheck size={22}/><strong>Your story. Your choice.</strong><p>Your journeys are private until you choose to share.</p></div><button className="profile-link" onClick={()=>setSheet('profile')}><span className="avatar"><User size={20}/></span><div><strong>{session?'Your account':'Your adventure starts here'}</strong><small>{session?'Manage profile':'Private local activities'}</small></div><ChevronRight size={16}/></button></div></aside>
 <main>{error&&<p role="alert" className="error">{error}</p>}{auth.status==='offline'&&<p className="notice">Offline · Private recordings stay on this device. Cloud actions require reconnection.</p>}<header className="topbar"><span className="mobile-brand"><AnimatedWordmark/></span><div className="breadcrumb">Your world, a little closer.</div><div className="top-actions"><span className="demo-label">{recording.state.active?`${recording.state.active.source==='simulator'?'SIMULATOR':'DEVICE'} · ${recording.state.active.state.toUpperCase()}`:recording.state.automaticTrip?'AUTO · RECORDING':'LOCAL FIRST'}</span><button className="icon-button" aria-label="Toggle dark theme" onClick={()=>setTheme(theme==='dark'?'light':'dark')}>{theme==='dark'?<Sun size={20}/>:<Moon size={20}/>}</button><button className="avatar" aria-label="Open profile" onClick={()=>setSheet('profile')}>{auth.preferences.avatar?<img className="avatar" src={auth.preferences.avatar} alt="Your profile"/>:<User size={20}/>}</button></div></header>
 {selectedJourney?<GroupedJourneyDetail key={selectedJourney.id} trip={selectedJourney} grouping={grouping} activities={realJourneys} places={recording.state.places||[]} recording={recording} onBack={()=>setSelected(null)} onPhoto={openPhoto} onEdit={trip=>{setSelected(trip);setSheet('nativeEdit');}}/>:selected&&!selected.isGroupedJourney?<ActivityDetail key={selected.id} trip={selectedActivity} places={recording.state.places||[]} onBack={()=>setSelected(null)} onEdit={()=>setSheet('nativeEdit')} onPhoto={openPhoto} run={recording.run} onUpdated={setSelected} onDeleted={()=>setSelected(null)} busy={recording.busy} error={recording.error}/>
:<div className="page-enter">
 <div className="page-heading"><div><p className="eyebrow">{tab==='Home'?'YOUR DAY, OUT THERE':tab==='Record'?'REAL GPS · PRIVATE BY DEFAULT':tab==='Social'?'SHARING ON YOUR TERMS':tab==='Map'?'YOUR RECORDED WORLD':'YOUR PERSONAL JOURNAL'}</p><h1>{tab==='Home'?'Your day.':tab==='Trips'?'Your activities.':tab==='Record'?'Record an activity.':tab==='Social'?'Adventures, together.':'Your world, mapped.'}</h1><p className="muted">{tab==='Home'?'A little movement. A little perspective. Your day at a glance.':tab==='Trips'?'Your journeys and memories, together in one place.':tab==='Record'?'Start here. Keep recording with the screen locked where iOS permits.':tab==='Social'?'Family and friends sharing is off. Nothing is published.':'Explore your routes and places.'}</p></div>{tab==='Trips'?<button type="button" className="secondary trips-add-activity" onClick={()=>setSheet('historical')}><Plus size={17}/> Add past activity</button>:tab==='Home'?<button className="primary" onClick={()=>setTab('Record')}><Plus size={19}/> Start activity</button>:null}</div>
 {tab==='Home'&&<><div className="overview home-today">{[[Route,total.toFixed(1),'km',"Today's distance",'distance','View longest trips first'],[ListChecks,todayJourneys.length,'','Activities today','newest','View newest trips first'],[Clock3,minutes,'min','Recorded time','duration','View longest durations first']].map(([Icon,value,unit,label,order,hint])=><button type="button" className="home-metric" key={label} aria-label={`${label}: ${value} ${unit}. ${hint}`} onClick={()=>{setQuery('');setFilter('All activities');setDayFilter('today');setSort(order);setFavouritesOnly(false);setTab('Trips');}}><span className="home-metric-icon"><span className="overview-icon"><Icon size={21}/></span><ChevronRight size={14} aria-hidden="true"/></span><span><strong>{value} {unit&&<small>{unit}</small>}</strong><span className="home-metric-label">{label}</span></span></button>)}</div><section className="home-tracking-summary"><span className="overview-icon"><ShieldCheck size={22}/></span><div><h2>Automatic tracking</h2><p className="muted">{recording.state.active?'Manual activity in progress':recording.state.automaticTrip?'Recording your journey':recording.state.automaticEnabled?(recording.state.automaticAvailable?'Ready for your next journey':'Review location permissions'):'Off · Enable it in tracking settings'}</p></div><button type="button" className="icon-button" aria-label="Tracking settings" onClick={()=>setSheet('tracking')}><ChevronRight size={20}/></button></section>{!realJourneys.length&&<div className="home-welcome"><h2>Your next chapter starts here.</h2><p className="muted">No device recordings yet.</p><p>Enable automatic tracking or start an activity. Your history will appear in Trips, and your routes in Map.</p></div>}</>}
 {tab==='Record'&&<RecorderPanel state={recording.state} run={recording.run} busy={recording.busy} error={recording.error} vehicles={vehicles} onFinished={trip=>{setSelected(trip);setTab('Trips');}}/>}
 {tab==='Trips'&&<><div className="trip-grouping-tools"><span className="muted small-copy">Drag one completed drive onto another to merge, or tap Merge on two drives.</span>{mergeSource&&<button type="button" className="text-button" onClick={()=>{setMergeSource(null);setMergeTarget(null);}}>Cancel selection</button>}<button type="button" className="text-button" onClick={()=>setSheet('grouping')}>Group journeys{grouping.suggestions.length?` · ${grouping.suggestions.length} suggestions`:""}</button>{grouping.metadata.history?.length>0&&<button className="text-button" disabled={grouping.busy} onClick={()=>grouping.act({type:'undo'})}>Undo grouping change</button>}</div><div className="trip-period-filter" role="group" aria-label="Activity date"><button type="button" aria-pressed={dayFilter==='all'} onClick={()=>setDayFilter('all')}>All dates</button><button type="button" aria-pressed={dayFilter==='today'} onClick={()=>setDayFilter('today')}>Today</button><button type="button" aria-pressed={favouritesOnly} onClick={()=>setFavouritesOnly(value=>!value)}><Star size={14} aria-hidden="true"/> Favourites</button></div><div className="filters"><label className="search"><Search size={18}/><input aria-label="Search journeys" placeholder="Search places, memories, dates…" value={query} onChange={e=>setQuery(e.target.value)}/></label><label className="select-filter"><SlidersHorizontal size={17}/><select aria-label="Filter activities" value={filter} onChange={e=>setFilter(e.target.value)}>{activities.map(a=><option key={a}>{a}</option>)}</select></label></div><div className="section-heading trip-results-heading"><div><h2>{filtered.length} {filtered.length===1?'activity':'activities'}</h2><p className="muted small-copy">{dayFilter==='today'?'Today · ':''}{sort==='duration'?`${Math.floor(filtered.reduce((sum,t)=>sum+t.durationSeconds,0)/60)} min recorded · Longest first`:sort==='distance'?`${(filtered.reduce((sum,t)=>sum+t.distanceMeters,0)/1000).toFixed(1)} km total · Longest first`:'Newest first'}</p></div><label className="trip-sort"><span>Sort by</span><select aria-label="Sort trips" value={sort} onChange={event=>setSort(event.target.value)}><option value="newest">Newest</option><option value="distance">Distance</option><option value="duration">Duration</option></select></label></div><div className="recent-activities trips-activity-list">{filtered.map(t=><div data-merge-id={canMergeRow(t)?t.id:undefined} onTouchStart={e=>touchStartMerge(e,t)} onTouchMove={touchMoveMerge} onTouchEnd={touchEndMerge} onTouchCancel={cancelTouchMerge} className={`trip-list-row ${dropTarget===t.id?'merge-drop-target':''} ${draggingTrip===t.id?'merge-dragging':''}`} key={t.id}
 draggable={canMergeRow(t)&&!grouping.busy}
 onDragStart={e=>{if(!canMergeRow(t))return;e.dataTransfer.setData('text/plain',t.id);e.dataTransfer.effectAllowed='move';setMergeSource(t.id);setDraggingTrip(t.id);}}
 onDragOver={e=>{if(canMergeRow(t)&&mergeSource&&mergeSource!==t.id){e.preventDefault();e.dataTransfer.dropEffect='move';setDropTarget(t.id);}}}
 onDragLeave={()=>{if(dropTarget===t.id)setDropTarget(null);}}
 onDrop={e=>{e.preventDefault();const source=e.dataTransfer.getData('text/plain')||mergeSource;setDropTarget(null);setDraggingTrip(null);if(source&&source!==t.id&&canMergeRow(t)){setMergeSource(source);setMergeTarget(t.id);}}}
 onDragEnd={()=>{setDropTarget(null);setDraggingTrip(null);}}><button type="button" className="recent-activity-row" onClick={()=>{if(suppressTripClick.current){suppressTripClick.current=false;return;}setSelected(t);}} aria-label={`Open ${t.title}`}><span className="recent-activity-icon"><ActivityIcon activity={t.activity} size={19}/></span><span className="recent-activity-info"><strong>{t.title}</strong><small>{t.isGroupedJourney?`${t.segmentIDs.length} drives · ${t.stops.length} stops`:t.activity} · {new Date(`${t.date}T12:00:00`).toLocaleDateString('en-AU',{day:'numeric',month:'short'})}</small></span><span className="recent-activity-distance">{sort==='duration'?<>{Math.floor(t.durationSeconds/60)} <small>min</small><small className="trip-time-distance">{t.distance} km</small></>:<>{t.distance} <small>km</small></>}</span><ChevronRight size={16} aria-hidden="true"/></button><button type="button" className="icon-button trip-row-bookmark" aria-pressed={saved.includes(t.id)} title={saved.includes(t.id)?'Remove from favourites':'Add to favourites'} aria-label={`${saved.includes(t.id)?'Remove from':'Add to'} favourites: ${t.title}`} onClick={()=>bookmark(t.id)}><Star size={17} fill={saved.includes(t.id)?'currentColor':'none'}/></button>{canMergeRow(t)&&<button type="button" className="text-button trip-merge-button" disabled={grouping.busy} onClick={()=>{if(mergeSource&&mergeSource!==t.id){setMergeTarget(t.id);}else{setMergeSource(t.id);setMergeTarget(null);}}} aria-label={mergeSource&&mergeSource!==t.id?`Merge with ${t.title}`:`Select ${t.title} to merge`}>{mergeSource&&mergeSource!==t.id?'Merge here':mergeSource===t.id?'Selected':'Merge'}</button>}</div>)}</div>{!filtered.length&&<div className="empty"><Search/><h2>No journeys found</h2><p>Try a different place, date or activity.</p><button className="secondary" onClick={()=>{setQuery('');setFilter('All activities');setDayFilter('all');setFavouritesOnly(false);}}>Clear filters</button></div>}</>}
 {floatingTrip&&touchPoint&&<div className="merge-floating-card" style={{left:touchPoint.x,top:touchPoint.y}} aria-hidden="true"><span className="merge-floating-icon"><ActivityIcon activity={floatingTrip.activity} size={20}/></span><span className="merge-floating-copy"><strong>{floatingTrip.title}</strong><small>{floatingTrip.distance} km · Drop on another drive</small></span></div>}
 {mergeSource&&mergeTarget&&<div className="modal-backdrop" role="presentation"><div className="notice" role="dialog" aria-modal="true" aria-label="Merge journeys" style={{maxWidth:440,margin:'auto',padding:24}}><h2>Merge these drives?</h2><p>Combine the two selected journeys into one timeline while retaining the original GPS recordings and stops. You can undo this later.</p><p className="muted small-copy">Only consecutive, compatible drives can be merged.</p>{grouping.error&&<p role="alert" className="error">{grouping.error}</p>}<div className="detail-actions"><button className="secondary" onClick={()=>{setMergeTarget(null);setMergeSource(null);}}>Cancel</button><button className="primary" disabled={grouping.busy} onClick={confirmMerge}>{grouping.busy?'Merging…':'Yes, merge'}</button></div></div></div>}
 {tab==='Social'&&<><Household/><p className="notice">Live location, friends, public feeds, likes, blocking and reporting are not available yet. Your recorded routes remain private.</p></>}
 {tab==='Map'&&<div className="map-explorer"><JourneyMap journeys={realJourneys} onPhoto={openPhoto} currentPosition={currentPosition} large locating={recording.busy} onLocate={async()=>{const point=await recording.run('currentPosition');if(point){setCurrentPosition(point);setError('');}else setError('Current location is unavailable. Check permissions or try outdoors.');}}/>{realJourneys.length>50&&<p className="muted small-copy">Showing the 50 most recent routes.</p>}</div>}

 <footer className="page-footer"><span>Go somewhere. Keep the feeling.</span><span><Lock size={12}/> Private by default</span></footer></div>}
 </main><nav className="mobile-nav">{[[Home,'Home'],[Map,'Map'],[CircleDot,'Record'],[Route,'Trips'],[Users,'Social']].map(([Icon,name])=><button key={name} className={tab===name?'active':''} onClick={()=>{setTab(name);setSelected(null);}}><Icon size={21}/><span>{name}</span></button>)}</nav>
 {sheet&&<div className="modal-backdrop" onClick={()=>setSheet(null)}><DismissibleSheet key={sheet} onClose={()=>setSheet(null)} label={sheet==='auth'?'Account access':sheet==='edit'?'Edit journey':sheet==='tracking'?'Tracking & Permissions':sheet==='diagnostics'?'Diagnostics':sheet==='garage'?'Garage':sheet==='places'?'Saved places':sheet==='nativeEdit'?'Edit activity':sheet==='historical'?'Add past activity':'Your profile'}><button className="close icon-button" aria-label="Close dialog" onClick={()=>setSheet(null)}><X/></button>
 {sheet==='grouping'&&<JourneyGroupingPanel activities={realJourneys} grouping={grouping} onClose={()=>setSheet(null)}/>}
 {sheet==='profile'&&<><span className="sheet-icon"><ShieldCheck size={28}/></span><p className="eyebrow">YOUR LITTLE CORNER</p><h2>{auth.preferences.displayName||'Your private world.'}</h2><p className="muted">{session?.user.email||'Create an account to get ready for your own story.'}</p><div className="status-row"><Lock size={18}/><div><strong>Private by default</strong><p>{recording.state.automaticEnabled?'Automatic history is enabled; family location sharing is off.':'Automatic history and family location sharing are off.'}</p></div></div><div className="status-row"><Star size={18}/><div><strong>{saved.length} favourite activities</strong><p>Favourites help you find trips again. They do not change sharing permissions.</p></div></div><div className="profile-tools"><button className="secondary full" onClick={()=>setSheet('diagnostics')}><Gauge size={17}/> Diagnostics</button><button className="secondary full" onClick={()=>setSheet('garage')}><CarIcon size={17}/> Garage & Tesla</button></div><div className="profile-tools"><button className="secondary full" onClick={()=>setSheet('places')}><MapPin size={17}/> Saved places</button></div><button className="primary full" onClick={()=>setSheet('account')}>Account & settings <ArrowRight size={18}/></button><button type="button" className="secondary full" onClick={()=>setSheet('tracking')}>Tracking & Permissions</button><button className="secondary full" onClick={()=>setSheet('household')}>Household</button><small className="muted">Your activities remain private. Household setup does not enable location sharing.</small></>}
 {sheet==='places'&&<Places places={recording.state.places||[]} run={recording.run} busy={recording.busy} error={recording.error}/>}
 {['nativeEdit','historical'].includes(sheet)&&<ActivityEditor trip={selected} vehicles={vehicles} run={recording.run} busy={recording.busy} error={recording.error} historical={sheet==='historical'} onSaved={(result,id)=>{const trip=result.trips.find(t=>t.id===id);if(trip)setSelected(recordedJourney(trip));setSheet(null);}}/>}
 {sheet==='diagnostics'&&<Diagnostics state={recording.state} session={session} preferences={auth.preferences} run={recording.run}/>}
 {sheet==='garage'&&<Garage vehicles={vehicles} onSave={setVehicles}/>}
 {sheet==='account'&&<AccountSettings recording={recording} onTracking={()=>setSheet('tracking')}/>}
 {sheet==='tracking'&&<TrackingPermissions recording={recording} onBack={()=>setSheet('account')}/>}
 {sheet==='household'&&<Household/>}

{error&&<p role="alert" className="error">{error}</p>}</DismissibleSheet></div>}
 {lightbox&&<div className="lightbox" role="dialog" aria-modal="true" aria-label="Journey photographs"><button className="close icon-button" aria-label="Close photographs" onClick={()=>setLightbox(null)}><X/></button><PrivateImage src={lightbox.trip.photos[lightbox.index].url} alt={lightbox.trip.photos[lightbox.index].caption}/><p>{lightbox.trip.photos[lightbox.index].caption}</p><div><button className="icon-button" aria-label="Previous photo" disabled={lightbox.index===0} onClick={()=>setLightbox({...lightbox,index:lightbox.index-1})}><ArrowLeft/></button><span>{lightbox.index+1} / {lightbox.trip.photos.length} · {lightbox.trip.source?'Private photo':'Demo photo'}</span><button className="icon-button" aria-label="Next photo" disabled={lightbox.index===lightbox.trip.photos.length-1} onClick={()=>setLightbox({...lightbox,index:lightbox.index+1})}><ArrowRight/></button></div></div>}
 </div>;
}
