import PersonAvatar from './components/PersonAvatar.jsx';
import MapLayers from './components/MapLayers.jsx';
import {activeLayerCount,activityChoices,loadMapView,mapViewJourneys,saveMapView} from './lib/mapLayers.js';
import {useMapOverview} from './lib/useMapOverview.js';
import {useMapLocation} from './lib/useMapLocation.js';
import {usePeopleAvatars} from './lib/usePeopleAvatars.js';
import Friends from './components/Friends.jsx';
import FriendTrips from './components/FriendTrips.jsx';
import HouseholdTrips from './components/HouseholdTrips.jsx';
import {useHouseholdPresence} from './lib/useHouseholdPresence.js';
import {LIVE_SECONDS,memberLocationState,peoplePins} from './lib/householdLocation.js';
import {useHomePresence} from './lib/useHomePresence.js';
import {cameraIntent,cameraReducer,initialCamera} from './lib/mapCamera.js';
import {secondsAtPlace} from './lib/peopleMap.js';
import {useFriendLocations} from './lib/useFriendLocations.js';
import {useFleetJourneys} from './lib/useFleetJourneys.js';
import {useJourneyGrouping} from './lib/useJourneyGrouping.js';
import JourneyGroupingPanel from './components/JourneyGroupingPanel.jsx';
import GroupedJourneyDetail from './components/GroupedJourneyDetail.jsx';
import AnimatedWordmark from './components/AnimatedWordmark.jsx';
import ActivityIcon from './components/ActivityIcon.jsx';
import TripsList from './components/TripsList.jsx';
import MobileNav from './components/MobileNav.jsx';
import NavButton from './components/NavButton.jsx';
import {NAV_ITEMS} from './lib/navigation.js';
import {recordControlState} from './lib/recordingState.js';
import AutoCloudSync from './components/AutoCloudSync.jsx';
import {distanceText,distanceValue,distanceUnitLabel} from './lib/distanceUnits.js';
import { setNativeAppearance } from './lib/appleMaps.js';
import TrackingPermissions from './components/TrackingPermissions.jsx';
import BrandMark from './components/BrandMark.jsx';
import DismissibleSheet from './components/DismissibleSheet.jsx';
import PrivateImage from './components/PrivateImage.jsx';
import EquipmentSheet from './components/EquipmentSheet.jsx';
import {EquipmentChip} from './components/EquipmentChip.jsx';
import {equipmentTripCount,equipmentUsage,itemTitle,tripEquipmentLabel,tripUsesEquipment} from './lib/collection.js';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ListChecks, Clock3, CircleDot, Users, Gauge, Car as CarIcon, ArrowUpRight, ArrowLeft, ArrowRight, Star, ChevronRight, Home, MapPin, Plus, Search, ShieldCheck, SlidersHorizontal, Sun, Moon, User, X, Route, Lock, GitMerge, EyeOff, Eye } from 'lucide-react';
import JourneyMap from './components/JourneyMap.jsx';
import MtbMap from './components/MtbMap.jsx';
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
import { recorderAvailable, recordedJourney, visibleRecorderJourneys } from './lib/recorder.js';
const activities=['All activities','Unknown','Cycling','MTB','Hiking','Mountain biking','Walking','Running','Road cycling','Kitesurfing','Driving','Other'];
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
 const [familySetup]=useState(()=>{try{return sessionStorage.getItem('letm3go:family-setup')===session.user.id;}catch{return false;}});
 useEffect(()=>{try{sessionStorage.removeItem('letm3go:family-setup');}catch{/* Optional navigation hint. */}},[]);
 const peopleAvatars=usePeopleAvatars(session.user.id,auth.status==='authenticated',auth.preferences.avatar);
 const unit=auth.preferences.distanceUnit||'km';
 const saved=useMemo(()=>auth.preferences.bookmarks||[],[auth.preferences.bookmarks]);
 const recording=useRecorder(session.user.id,auth.rebindRecorder);
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
 const presenceHidden=!(presence.liveEnabled||friendsLocation.enabled);
 const refreshAvatars=peopleAvatars.refresh,refreshLiveLocations=presence.refreshLive;
 const refreshHousehold=useCallback(()=>{refreshAvatars();void refreshLiveLocations();},[refreshAvatars,refreshLiveLocations]);
 const [photoZoom,setPhotoZoom]=useState(1);
 const photoPinch=useRef(null);
 const fleet=useFleetJourneys(session.user.id,true);
 // `useRecorder` returns a stable snapshot between real changes, so memoising the
 // grouping input and trip projections on their raw fields prevents
 // `reconcileSources` + `buildJourneys` from re-running over every journey on each
 // two-second recorder poll — the dominant cause of jank while scrolling lists.
 const vehicles=useMemo(()=>auth.preferences.vehicles||[],[auth.preferences.vehicles]);
 const groupingActivities=useMemo(()=>{
  if(recording.state.ownerID&&recording.state.ownerID.toLowerCase()!==session.user.id.toLowerCase())return [];
  return recording.state.trips.filter(t=>t.source==='device'&&t.details?.provisional!==true).map(recordedJourney).concat(fleet.activities);
 },[recording.state.trips,fleet.activities,recording.state.ownerID,session.user.id]);
 const grouping=useJourneyGrouping({owner:session.user.id,activities:groupingActivities,telemetry:fleet.charges,places:recording.state.places||[],vehicles,serialized:auth.preferences.journeyGrouping,savePreferences:auth.savePreferences});
 // A removed Collection item leaves an explicit tombstone receipt so the cloud
 // copy is deleted on the next sync. Restore therefore cannot resurrect it.
 const setVehicles=async next=>{
  const previous=vehicles;
  const removed=(Array.isArray(next)?previous:[]).filter(item=>!next.some(entry=>String(entry?.id)===String(item?.id)));
  if(!removed.length)return auth.savePreferences({vehicles:next});
  const receipts={...(auth.preferences.syncReceipts||{})};
  for(const item of removed)receipts[`collection:${item.id}`]={owner:session.user.id,deleted:true};
  return auth.savePreferences({vehicles:next,syncReceipts:receipts});
 };
 const realJourneys=useMemo(()=>recording.state.trips.filter(t=>t.source==='device').map(recordedJourney),[recording.state.trips]);
 const [mergeSource,setMergeSource]=useState(null),[mergeTarget,setMergeTarget]=useState(null);
 const archiveKey='letm3go:archived-trips:'+session.user.id;
 // Archived trips belong to the account, not to one installation: they now live
 // in the encrypted preferences file (and in the settings backup) so a restored
 // device keeps them. A list written by an older build is used until the first
 // successful save moves it into preferences.
 const [legacyArchived]=useState(()=>{try{const value=JSON.parse(localStorage.getItem(archiveKey)||'[]');return Array.isArray(value)?value:[];}catch{return [];}});
 const archivedTrips=auth.preferences.archivedTrips??legacyArchived;
 useEffect(()=>{
  if(!legacyArchived.length||auth.preferences.archivedTrips)return;
  void auth.savePreferences({archivedTrips:legacyArchived})
   .then(()=>localStorage.removeItem(archiveKey))
   .catch(()=>{/* Keep using the plaintext list until a save succeeds. */});
  // Runs once per sign-in: the legacy key is tied to this account id.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 const [showArchived,setShowArchived]=useState(false);
 const [lastArchived,setLastArchived]=useState(null);
 const [deleteTrip,setDeleteTrip]=useState(null);
 const archiveTrip=trip=>{
  void auth.savePreferences({archivedTrips:[...new Set([...archivedTrips,trip.id])]}).catch(err=>setError(err.message||'Archive could not be saved.'));
  setLastArchived(trip);
 };
 const restoreTrip=id=>{
  void auth.savePreferences({archivedTrips:archivedTrips.filter(x=>x!==id)}).catch(err=>setError(err.message||'Archive could not be saved.'));
  setLastArchived(null);setShowArchived(false);
 };
 // Trip rows are memoised so a recorder poll cannot re-render them, which means the
 // callbacks they receive must keep a stable identity even though they close over
 // this render's favourites, archive list and preferences saver. The ref always
 // points at the newest closure; the function handed to the list never changes.
 const latestActions=useRef({});
 const bookmarkRow=useCallback(id=>void latestActions.current.bookmark(id),[]);
 const archiveRow=useCallback(trip=>latestActions.current.archiveTrip(trip),[]);
 const restoreRow=useCallback(id=>latestActions.current.restoreTrip(id),[]);
 async function confirmTripDelete(){
  if(!deleteTrip||recording.busy||!['device','simulator'].includes(deleteTrip.source)||deleteTrip.isGroupedJourney)return;
  const result=await recording.run('deleteActivity',deleteTrip.id);
  if(result){setDeleteTrip(null);setSelected(null);}
 }
 const [metricView,setMetricView]=useState(null);
 const [socialSection,setSocialSection]=useState('household');
 const [pendingInvitation,setPendingInvitation]=useState(()=>{try{return JSON.parse(sessionStorage.getItem('letm3go:pending-invitation')||'null');}catch{return null;}});
 // What the Map shows (map, people, routes, filters), kept per account so it
 // survives tab changes and relaunches.
 const [mapView,setMapView]=useState(()=>loadMapView(session.user.id));
 useEffect(()=>{saveMapView(session.user.id,mapView);},[session.user.id,mapView]);
 const [layersOpen,setLayersOpen]=useState(false);
 const closeLayers=useCallback(()=>setLayersOpen(false),[]);
 const openLayers=useCallback(()=>setLayersOpen(true),[]);

 const [mapCenterVersion,setMapCenterVersion]=useState(0);
 // Show everyone, follow a person or explore freely (see lib/mapCamera.js).
 const [camera,dispatchCamera]=useReducer(cameraReducer,initialCamera);
 const [tripSearchOpen,setTripSearchOpen]=useState(false);
 const [tripFiltersOpen,setTripFiltersOpen]=useState(false);
 const [tripActionsOpen,setTripActionsOpen]=useState(false);
 const [equipmentFilter,setEquipmentFilter]=useState('');
 const [equipmentTarget,setEquipmentTarget]=useState(null);
 const tripSearchRef=useRef(null);

 const [tab,setTab]=useState(familySetup?'Social':'Home'),[selected,setSelected]=useState(null),[sheet,setSheet]=useState(null),[query,setQuery]=useState(''),[filter,setFilter]=useState('All activities'),[dayFilter,setDayFilter]=useState('all'),[sortPreference,setSortPreference]=useState(()=>{const saved=localStorage.getItem('letm3go-trip-sort');return ['newest','distance','duration'].includes(saved)?saved:'newest';}),[favouritesOnly,setFavouritesOnly]=useState(false),[error,setError]=useState(''),[lightbox,setLightbox]=useState(null),[theme,setTheme]=useState(()=>localStorage.getItem('letm3go-theme')||'light');
 const mapLocation=useMapLocation(session.user.id,tab==='Map',recording.state.permission);
 // People on the map and in Household: one state per person from one policy.
 const homePlace=useMemo(()=>(recording.state.places||[]).find(p=>p.kind==='home')||null,[recording.state.places]);
 const householdMembers=useMemo(()=>presence.liveMembers.map(row=>({...row,...memberLocationState(row),source:'household'})),[presence.liveMembers]);
 // A member who joins (or first appears) after photos loaded gets their photo
 // without waiting for the app to return to the foreground.
 const householdMemberKey=householdMembers.map(m=>m.user_id).sort().join(',');
 useEffect(()=>{if(householdMemberKey)refreshAvatars();},[householdMemberKey,refreshAvatars]);
 const friendMembers=useMemo(()=>friendsLocation.people.filter(p=>!presence.liveMembers.some(m=>m.user_id===p.user_id))
  .map(p=>({...p,sharing_enabled:true,location_at:p.updated_at,server_now:new Date(motionClock).toISOString(),source:'friend'}))
  .map(row=>({...row,...memberLocationState(row)})),[friendsLocation.people,presence.liveMembers,motionClock]);
 // Home is the saved Home place; only a live position can place someone there.
 const homeFlags=useHomePresence([
  {id:'self',eligible:Boolean(mapLocation.position),point:mapLocation.position},
  ...householdMembers.map(m=>({id:m.user_id,eligible:m.state==='live',point:m.position}))
 ],homePlace);
 // Coarse statuses members already share (Driving, Walking...), for the person model only.
 const sharedActivities=useMemo(()=>Object.fromEntries(presence.people.filter(p=>p.user_id&&p.activity_label).map(p=>[p.user_id,p.activity_label])),[presence.people]);
 // Your own time at a place, as your household sees it, and only while your
 // shared position is current, so it never outlives what was actually published.
 const selfArrival=presence.selfArrival;
 const selfSeconds=presence.liveEnabled&&selfArrival?.location_at&&Date.parse(selfArrival.server_now)-Date.parse(selfArrival.location_at)<=LIVE_SECONDS*1000?secondsAtPlace({...selfArrival,state:'live'}):null;
 const savedPlaces=recording.state.places;
 const mapPeople=useMemo(()=>peoplePins({
  self:mapLocation.position?{latitude:mapLocation.position.latitude,longitude:mapLocation.position.longitude,accuracy:mapLocation.position.accuracy,name:auth.preferences.displayName||'You',home:homeFlags.self===true,seconds:selfSeconds,activity:automaticPresenceActivity}:null,
  members:[...householdMembers.map(m=>({...m,home:homeFlags[m.user_id]===true})),...friendMembers],
  photos:peopleAvatars.photos,selfId:session.user.id,selfAvatar:auth.preferences.avatar,places:savedPlaces||[],activities:sharedActivities
 }),[mapLocation.position,householdMembers,friendMembers,homeFlags,peopleAvatars.photos,session.user.id,auth.preferences.avatar,auth.preferences.displayName,selfSeconds,automaticPresenceActivity,savedPlaces,sharedActivities]);
 // What the household sees of you: confirmed sends, not just the switch.
 const selfSharedAt=Math.max(presence.lastPublishedAt||0,(recording.state.nativeFamilySharing?.lastUploadOkAt||0)*1000);
 const selfLocationState=!presence.liveEnabled?{state:'off',ageSeconds:null}:
  selfSharedAt?{state:motionClock-selfSharedAt<=LIVE_SECONDS*1000?'live':'stale',ageSeconds:Math.max(0,Math.round((motionClock-selfSharedAt)/1000))}:{state:'waiting',ageSeconds:null};
 // You are "At home" in Social only with a current position of your own (the map
 // keeps its last fix after you leave the Map tab, which may be old).
 const selfFix=mapLocation.position;
 const selfAtHome=homeFlags.self===true&&Boolean(selfFix)&&Number.isFinite(selfFix.timestamp)&&motionClock/1000-selfFix.timestamp<=LIVE_SECONDS;
 const householdLocationProps=useMemo(()=>({
  memberLocations:Object.fromEntries(householdMembers.map(m=>[m.user_id,{state:m.state,ageSeconds:m.ageSeconds,position:m.position,home:homeFlags[m.user_id]===true&&m.state==='live',activity:sharedActivities[m.user_id]||null}])),
  selfLocation:{state:selfLocationState.state,ageSeconds:selfLocationState.ageSeconds,home:selfLocationState.state==='live'&&selfAtHome,activity:presence.self?.activity_label||null}
 }),[householdMembers,homeFlags,sharedActivities,selfLocationState.state,selfLocationState.ageSeconds,selfAtHome,presence.self?.activity_label]);
 // What friends actually received from you: confirmed sends, not the setting.
 const friendSentAt=friendsLocation.lastSentAt||0;
 const friendSelf=!friendsLocation.enabled||!friendSentAt?{state:'waiting',ageSeconds:null}:{state:motionClock-friendSentAt<=LIVE_SECONDS*1000?'live':'stale',ageSeconds:Math.max(0,Math.round((motionClock-friendSentAt)/1000))};
 // Friends' positions in the same states as the map. A friend without a row has
 // no recent position, which is not the same as sharing turned off.
 const friendLocations=useMemo(()=>Object.fromEntries(friendsLocation.people.map(p=>{
  const state=memberLocationState({...p,sharing_enabled:true,location_at:p.updated_at,server_now:new Date(motionClock).toISOString()});
  return [p.user_id,{state:state.state,ageSeconds:state.ageSeconds,position:state.position}];
 })),[friendsLocation.people,motionClock]);
 // Explicit navigation to one member follows that person; the map otherwise shows everyone.
 const showOnMap=useCallback((position,userId)=>{setSheet(null);setSelected(null);setMapView(view=>({...view,content:'routes',people:true}));dispatchCamera(userId?{type:'focus',personId:userId}:{type:'showAll'});setTab('Map');},[]);
 const openPeopleMap=useCallback(()=>{setSheet(null);setSelected(null);setMapView(view=>({...view,content:'routes',people:true}));dispatchCamera({type:'showAll'});setTab('Map');},[]);
 const onMapCamera=useCallback(event=>dispatchCamera({type:'native',mode:event.mode,personId:event.personId,command:event.command}),[]);
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
 const openPhoto=useCallback((trip,id)=>{const index=trip.photos?.findIndex(p=>String(p.id)===String(id))??-1;if(index>=0){setPhotoZoom(1);setLightbox({trip,index});}},[setLightbox]);
 async function bookmark(id){const next=saved.includes(id)?saved.filter(x=>x!==id):[...saved,id];try{await auth.savePreferences({bookmarks:next});}catch(err){setError(err.message||'Favourite could not be saved.');}}
 // Declared after every action it wraps so the ref assignment never reads a value
 // before it is declared; it runs on each commit, exposing the newest closures.
 useEffect(()=>{latestActions.current={bookmark,archiveTrip,restoreTrip};});
 const sort=metricView==="Today's distance"?'distance':metricView==='Recorded time'?'duration':metricView==='Activities today'?'newest':sortPreference;
 const visibleJourneys=useMemo(()=>visibleRecorderJourneys(grouping.journeys,recording.state,session.user.id),[grouping.journeys,recording.state,session.user.id]);
 // Equipment counts and filters come from the journeys already in memory, so a
 // Collection item and the Trips list can never disagree.
 const equipmentOptions=useMemo(()=>equipmentUsage(visibleJourneys,vehicles),[visibleJourneys,vehicles]);
 const activeEquipmentFilter=equipmentOptions.some(option=>String(option.item.id)===equipmentFilter)?equipmentFilter:'';
 const activeEquipmentName=activeEquipmentFilter?itemTitle(equipmentOptions.find(option=>String(option.item.id)===activeEquipmentFilter)?.item||{}):'';
 const equipmentTripCounts=useMemo(()=>Object.fromEntries(vehicles.map(item=>[item.id,equipmentTripCount(visibleJourneys,vehicles,item.id)])),[visibleJourneys,vehicles]);
 function openEquipment(trip){setEquipmentTarget(trip);setSheet('equipment');}
 async function assignEquipment(ids){
  const trip=equipmentTarget;
  if(!trip)return false;
  const result=await recording.run('assignEquipment',{id:trip.id,ids});
  return Boolean(result);
 }
 // Starting from a community trail saves the link with the activity before any
 // GPS arrives, so the ride can be recorded offline and linked later if needed.
 async function recordTrail(trail){
  if(!trail?.id)return false;
  const result=await recording.run('start','MTB',undefined,undefined,{id:trail.id,name:trail.name,distanceMeters:trail.distance_meters});
  if(result){setSheet(null);setSelected(null);setTab('Record');return true;}
  return false;
 }
 async function addCollectionItem(item){
  try{await setVehicles([...vehicles,item]);return true;}catch{return false;}
 }
 const selectedJourney=selected?.isGroupedJourney?visibleJourneys.find(j=>j.id===selected.id):null;
 const selectedActivity=selected&&!selected.isGroupedJourney?(visibleJourneys.find(j=>j.id===selected.id)||realJourneys.find(j=>j.id===selected.id)||selected):null;
 const today=new Date().toLocaleDateString('en-CA');
 const mapJourneys=useMemo(()=>mapViewJourneys(grouping.journeys,mapView,today,saved),[grouping.journeys,mapView,today,saved]);
 const mapActivities=useMemo(()=>activityChoices(grouping.journeys),[grouping.journeys]);
 // The route overview: a density map of every shown journey (not only the 50
 // most recent) with clustered photos. Rebuilt only when the journeys change.
 const overviewState=useMapOverview(mapJourneys,{enabled:tab==='Map'&&mapView.content==='routes'&&Boolean(mapView.routes),unit});
 const overview=overviewState.overview;
 const peopleOnMap=mapView.content==='routes'&&mapView.people;
 const shiftDay=(day,offset)=>{const basis=day==='all'||day==='today'?new Date():new Date(day+'T12:00:00');basis.setDate(basis.getDate()+offset);return basis.toLocaleDateString('en-CA');};
 const chosenDay=dayFilter==='today'?today:dayFilter;
 const filtered=useMemo(()=>visibleJourneys.filter(t=>(showArchived?archivedTrips.includes(t.id):!archivedTrips.includes(t.id))&&(!favouritesOnly||saved.includes(t.id))&&((tripSearchOpen&&query.trim())||dayFilter==='all'||t.date===chosenDay||t.segments?.some(s=>s.date===chosenDay))&&(filter==='All activities'||t.activity===filter)&&(!activeEquipmentFilter||tripUsesEquipment(t,vehicles,activeEquipmentFilter))&&`${t.searchIndex||''} ${t.title} ${t.location} ${t.date} ${t.collection||''} ${t.notes||''} ${t.tags.join(' ')} ${tripEquipmentLabel(t,vehicles)}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>sort==='duration'?b.durationSeconds-a.durationSeconds||b.startedAt-a.startedAt:sort==='distance'?b.distanceMeters-a.distanceMeters||b.startedAt-a.startedAt:b.startedAt-a.startedAt),[visibleJourneys,showArchived,archivedTrips,favouritesOnly,saved,tripSearchOpen,query,dayFilter,chosenDay,filter,activeEquipmentFilter,vehicles,sort]);
 const confirmMerge=async()=>{
  if(!mergeSource||!mergeTarget)return;
  const expand=id=>{const trip=grouping.journeys.find(t=>t.id===id);return trip?.isGroupedJourney?trip.segmentIDs:[id];};
  const pair=[...new Set([...expand(mergeSource),...expand(mergeTarget)])];
  const success=await grouping.act({type:'merge',ids:pair});
  if(success){setMergeSource(null);setMergeTarget(null);}
 };
 // Today's metrics come from the same journeys shown in Trips and "Last activity",
 // so a provisional or still-recording journey is never counted on one surface and
 // omitted on another. Shared household journeys (readOnly) belong to other members.
 const todayJourneys=useMemo(()=>visibleJourneys.filter(t=>!t.readOnly&&t.date===today),[visibleJourneys,today]);
 const total=todayJourneys.reduce((n,t)=>n+(t.distanceMeters||0),0)/1000;
 const minutes=Math.floor(todayJourneys.reduce((n,t)=>n+(t.durationSeconds||0),0)/60);
 return <><AutoCloudSync state={recording.state}/><div className="app-shell"><aside className="desktop-rail"><a className="brand" href="#" onClick={e=>{e.preventDefault();setSelected(null);setTab('Home');}} aria-label="Letm3go Home"><AnimatedWordmark/></a><p className="rail-caption">MAKE ROOM FOR ADVENTURE</p><nav>{NAV_ITEMS.map(({name})=><NavButton key={name} name={name} active={tab===name&&!selected} onSelect={()=>{setTab(name);setSelected(null);}}/>)}</nav><div className="rail-bottom"><div className="private-note"><ShieldCheck size={22}/><strong>Your story. Your choice.</strong><p>Your journeys are private until you choose to share.</p></div><button className="profile-link" onClick={()=>setSheet('profile')}><span className="avatar"><User size={20}/></span><div><strong>{session?'Your account':'Your adventure starts here'}</strong><small>{session?'Manage profile':'Private local activities'}</small></div><ChevronRight size={16}/></button></div></aside>
  <main>{error&&<p role="alert" className="error">{error}</p>}{recording.error&&<p role="alert" className="error">{recording.error}</p>}{auth.status==='offline'&&<p className="notice">Offline · Private recordings stay on this device. Cloud actions require reconnection.</p>}<header className="topbar"><span className="mobile-brand"><AnimatedWordmark/></span><div className="breadcrumb">Your world, a little closer.</div><div className="top-actions"><button className="icon-button" aria-label="Toggle dark theme" onClick={()=>setTheme(theme==='dark'?'light':'dark')}>{theme==='dark'?<Sun size={20}/>:<Moon size={20}/>}</button><button type="button" className={`icon-button presence-toggle ${presenceHidden?'presence-hidden':'presence-visible'}`} aria-label="Location sharing" title="Location sharing" onClick={()=>{setSelected(null);setSheet(null);setTab('Social');setSocialSection('household');}}><MapPin size={20}/></button><button type="button" className="avatar header-avatar" aria-label="Open profile" onClick={()=>setSheet('profile')}><PersonAvatar name={auth.preferences.displayName||'You'} userId={session.user.id} selfId={session.user.id} selfAvatar={auth.preferences.avatar} photos={peopleAvatars.photos} size="sm"/></button></div></header>
 {recording.state.active&&<button type="button" className="active-recording-banner" onClick={()=>{setSelected(null);setSheet(null);setTab("Record");}} aria-label="Return to active recording"><span className="live-dot"/><strong>{recording.state.active.activity} · {recording.state.active.state==="recording"?"Recording": "Paused"}</strong><span>Continue exploring · tap to view recording</span><ArrowRight size={17}/></button>}
 {selectedJourney?<GroupedJourneyDetail unit={unit} key={selectedJourney.id} trip={selectedJourney} grouping={grouping} activities={realJourneys} places={recording.state.places||[]} recording={recording} onBack={()=>setSelected(null)} onPhoto={openPhoto} onEdit={trip=>{setSelected(trip);setSheet('nativeEdit');}}/>:selected&&!selected.isGroupedJourney?<ActivityDetail unit={unit} key={`${selected.id}:${selectedActivity?.state||'finished'}`} trip={selectedActivity} vehicles={vehicles} onEquipment={openEquipment} onStopChange={grouping.act} grouping={grouping} onSource={setSelected} places={recording.state.places||[]} onBack={()=>setSelected(null)} onEdit={()=>setSheet('nativeEdit')} onPhoto={openPhoto} run={recording.run} onUpdated={setSelected} onDeleted={()=>setSelected(null)} busy={recording.busy} error={recording.error}/>
:<div className="page-enter">
 {tab==='Trips'?<div className="trip-journal-heading"><div><p className="eyebrow">YOUR PERSONAL JOURNAL</p><h1>Your activities</h1></div><div className="trip-heading-actions"><button type="button" className="trip-round-action" aria-label={tripSearchOpen?'Close activity search':'Search all activities'} aria-expanded={tripSearchOpen} onClick={()=>{if(tripSearchOpen)setQuery('');setTripSearchOpen(v=>!v);setTripActionsOpen(false);setDayFilter('all');}}>{tripSearchOpen?<X size={20}/>:<Search size={20}/>}</button><button type="button" className="trip-round-action" aria-label="Activity filters" aria-expanded={tripFiltersOpen} onClick={()=>{setTripFiltersOpen(v=>!v);setTripActionsOpen(false);}}><SlidersHorizontal size={20}/></button><button type="button" className="trip-round-action" aria-label="More activity actions" aria-expanded={tripActionsOpen} onClick={()=>{setTripActionsOpen(v=>!v);setTripFiltersOpen(false);}}><Plus size={21}/></button></div></div>:tab==='Map'?null:<div className="page-heading"><div><p className="eyebrow">{tab==='Home'?'YOUR DAY, OUT THERE':tab==='Record'?'REAL GPS · PRIVATE BY DEFAULT':tab==='Social'?'YOUR PEOPLE':'YOUR RECORDED WORLD'}</p><h1>{tab==='Home'?'Your day. Your way.':tab==='Record'?'Record an activity.':tab==='Social'?'Your people.':'Your world, mapped.'}</h1><p className="muted">{tab==='Home'?'A little movement. A little perspective. Your day at a glance.':tab==='Record'?'Start here. Keep recording with the screen locked where iOS permits.':tab==='Social'?(presence.liveEnabled||friendsLocation.enabled?'Live sharing is on. You can turn it off any time.':'Connect with people. Share live only when you choose.'):'Explore your routes and places.'}</p></div>{tab==='Home'?<button className="primary" onClick={()=>setTab('Record')}><Plus size={19}/> Start activity</button>:null}</div>}
 {tab==='Home'&&<><div className="overview home-today">{[[Route,distanceValue(total,unit),distanceUnitLabel(unit),"Today's distance",'distance','View longest trips first'],[ListChecks,todayJourneys.length,'','Activities today','newest','View newest trips first'],[Clock3,minutes,'min','Recorded time','duration','View longest durations first']].map(([Icon,value,unit,label,,hint])=><button type="button" className="home-metric" key={label} aria-label={`${label}: ${value} ${unit}. ${hint}`} onClick={()=>{setQuery('');setFilter('All activities');setDayFilter('today');setMetricView(label);setFavouritesOnly(false);setTab('Trips');}}><span className="home-metric-icon"><span className="overview-icon"><Icon size={21}/></span><ChevronRight size={14} aria-hidden="true"/></span><span><strong>{value} {unit&&<small>{unit}</small>}</strong><span className="home-metric-label">{label}</span></span></button>)}</div><div className="home-highlights">
 <section className="home-highlight-card">
  <div className="home-highlight-heading"><h2>Last activity</h2><button type="button" className="text-button" onClick={()=>{setTab('Trips');setMetricView(null);setDayFilter('all');}}>See all <ChevronRight size={15}/></button></div>
  {visibleJourneys.length?(()=>{const latest=[...visibleJourneys].sort((a,b)=>b.startedAt-a.startedAt)[0];return <button type="button" className="home-last-activity" onClick={()=>{setSelected(latest);setTab('Trips');}}><span className="overview-icon"><ActivityIcon activity={latest.activity} size={21}/></span><span className="home-last-activity-info"><strong>{latest.title}</strong><small>{new Date(latest.startedAt*1000).toLocaleDateString('en-AU',{day:'numeric',month:'short'})} · {new Date(latest.startedAt*1000).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'})}{latest.endedAt?' – '+new Date(latest.endedAt*1000).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'}):''}</small><small>{latest.activity} · {distanceText(latest.distance,unit)}</small></span><ChevronRight size={18}/></button>;})():<p className="muted small-copy">Your next recorded activity will appear here.</p>}
 </section>
 <section className="home-highlight-card">
  <div className="home-highlight-heading"><h2>Friends</h2><button type="button" className="text-button" onClick={()=>{setSocialSection('friends');setTab('Social');}}>See friends <ChevronRight size={15}/></button></div>
  {friendsLocation.people.length?<div className="home-friends-live">{friendsLocation.people.slice(0,4).map(person=><button type="button" className="home-friends-preview" key={person.user_id} onClick={()=>setTab('Social')}><PersonAvatar name={person.display_name} userId={person.user_id} selfId={session.user.id} selfAvatar={auth.preferences.avatar} photos={peopleAvatars.photos}/><span><strong>{person.display_name}</strong><small>Last known location</small><small>Updated {new Date(person.updated_at).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'})}</small></span><ChevronRight size={16}/></button>)}</div>:<button type="button" className="home-friends-preview" onClick={()=>setTab('Social')}><span className={`home-friends-avatar ${presenceHidden?'home-presence-hidden':''}`}>{presenceHidden?<EyeOff size={21}/>:<Users size={21}/>}</span><span><strong>No recent shared statuses</strong><small>Friends who opt in appear here when their location is recent.</small><small>{friendsLocation.enabled?'You are sharing with friends':'Your friend location is not shared'}</small></span><ChevronRight size={18}/></button>}
 </section>
 </div>{!grouping.records.length&&<div className="home-welcome"><h2>Your next chapter starts here.</h2><p className="muted">No device recordings yet.</p><p>Enable automatic tracking or start an activity. Your history will appear in Trips, and your routes in Map.</p></div>}</>}
 {tab==='Record'&&<RecorderPanel state={recording.state} run={recording.run} busy={recording.busy} error={recording.error} vehicles={vehicles} onFinished={trip=>{setSelected(trip);setTab('Trips');}}/>}
 {tab==='Trips'&&<>{fleet.error&&vehicles.some(v=>v.source==='tesla')&&<p role="status" className="notice">{fleet.error}</p>}{fleet.more&&<button className="text-button" disabled={fleet.loadingMore} onClick={fleet.loadMore}>{fleet.loadingMore?'Loading…':'Load older Tesla journeys'}</button>}{tripActionsOpen&&<div className="trip-popover" role="group" aria-label="Activity actions"><button type="button" onClick={()=>{setSheet('historical');setTripActionsOpen(false);}}><Plus size={17}/> Add past activity</button><button type="button" onClick={()=>{setSheet('grouping');setTripActionsOpen(false);}}><GitMerge size={17}/> Manage merged journeys</button>{grouping.metadata.history?.length>0&&<button type="button" disabled={grouping.busy} onClick={()=>{grouping.act({type:'undo'});setTripActionsOpen(false);}}>Undo last grouping change</button>}</div>}
{lastArchived&&<div className="trip-archive-toast" role="status"><span>Archived “{lastArchived.title}”</span><button type="button" onClick={()=>restoreTrip(lastArchived.id)}>Undo</button></div>}
{(archivedTrips.length>0||showArchived)&&<button type="button" className="trip-archived-toggle" onClick={()=>{setShowArchived(v=>!v);setLastArchived(null);}}>{showArchived?'Back to activities':`Archived activities (${archivedTrips.length})`}</button>}
{tripSearchOpen&&<div className="trip-expanded-search"><Search size={19}/><input ref={tripSearchRef} type="search" aria-label="Search all activity history" placeholder="Search places, activities, tags, dates…" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button type="button" aria-label="Clear search" onClick={()=>setQuery('')}><X size={18}/></button>}</div>}
{tripFiltersOpen&&<div className="trip-expanded-filters"><label>Activity type<select aria-label="Filter activities" value={filter} onChange={e=>setFilter(e.target.value)}>{activities.map(a=><option key={a}>{a}</option>)}</select></label><label>Sort by<select aria-label="Sort trips" value={sort} onChange={event=>{setSortPreference(event.target.value);localStorage.setItem('letm3go-trip-sort',event.target.value);setMetricView(null);}}><option value="newest">Newest</option><option value="distance">Distance</option><option value="duration">Duration</option></select></label>{equipmentOptions.length>0&&<label className="wide">Equipment<select aria-label="Filter by equipment" value={activeEquipmentFilter} onChange={event=>setEquipmentFilter(event.target.value)}><option value="">Any equipment</option>{equipmentOptions.map(({item,count})=><option key={item.id} value={item.id}>{itemTitle(item)} ({count})</option>)}</select></label>}</div>}
{activeEquipmentFilter&&<div className="trip-active-filters"><button type="button" className="trip-filter-chip" aria-label={`Remove equipment filter ${activeEquipmentName}`} onClick={()=>setEquipmentFilter('')}>Using {activeEquipmentName}<X size={14} aria-hidden="true"/></button></div>}
{mergeSource&&<div className="trip-merge-hint">Select a second drive to merge. <button type="button" className="text-button" onClick={()=>{setMergeSource(null);setMergeTarget(null);}}>Cancel</button></div>}
<div className="trip-compact-navigation"><div className="trip-period-filter" role="group" aria-label="Activity date"><button type="button" aria-pressed={dayFilter==='all'} onClick={()=>setDayFilter('all')}>All</button><button type="button" aria-pressed={dayFilter==='today'} onClick={()=>setDayFilter('today')}>Today</button><button type="button" aria-pressed={favouritesOnly} onClick={()=>setFavouritesOnly(value=>!value)}><Star size={14} aria-hidden="true"/> Favourites</button></div><div className="trip-date-navigator" role="group" aria-label="Browse journey dates"><button type="button" aria-label="Previous day" onClick={()=>setDayFilter(shiftDay(chosenDay,-1))}><ChevronRight className="trip-prev-icon" size={18}/></button><label><input type="date" aria-label="Choose journey date" value={chosenDay==='all'?today:chosenDay} max={today} onChange={e=>{if(e.target.value)setDayFilter(e.target.value);}}/></label><button type="button" aria-label="Next day" disabled={chosenDay==='all'||chosenDay>=today} onClick={()=>setDayFilter(shiftDay(chosenDay,1))}><ChevronRight size={18}/></button></div></div>
<div className="section-heading trip-results-heading"><div><h2>{filtered.length} {filtered.length===1?'activity':'activities'}</h2><p className="muted small-copy">{dayFilter==='today'?'Today · ':dayFilter!=='all'?`${new Date(chosenDay+'T12:00:00').toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'})} · `:''}{sort==='duration'?`${Math.floor(filtered.reduce((sum,t)=>sum+t.durationSeconds,0)/60)} min recorded · Longest first`:sort==='distance'?`${distanceText(filtered.reduce((sum,t)=>sum+t.distanceMeters,0)/1000,unit)} total · Longest first`:'Newest first'}</p></div></div>
{filtered.length?<TripsList key={`${filter}|${dayFilter}|${favouritesOnly}|${activeEquipmentFilter}|${sort}|${showArchived}`} journeys={filtered} unit={unit} sort={sort} query={query} favourites={saved} vehicles={vehicles} busy={grouping.busy} showArchived={showArchived} mergeSource={mergeSource} mergeTarget={mergeTarget} onOpen={setSelected} onBookmark={bookmarkRow} onEquipment={openEquipment} onArchive={archiveRow} onRestore={restoreRow} onMergeSelect={setMergeSource} onMergeTarget={setMergeTarget}/>:<div className="empty"><Search/><h2>No journeys found</h2><p>Try a different place, date or activity.</p><button className="secondary" onClick={()=>{setQuery('');setFilter('All activities');setDayFilter('all');setFavouritesOnly(false);setEquipmentFilter('');}}>Clear filters</button></div>}</>}
{deleteTrip&&<div className="trip-delete-confirm" role="dialog" aria-label="Delete activity"><strong>Delete {deleteTrip.title}?</strong><p>This permanently removes the local activity and its saved route. Original photos in your library remain.</p><div className="detail-actions"><button type="button" className="secondary" onClick={()=>setDeleteTrip(null)}>Cancel</button><button type="button" className="primary" disabled={recording.busy} onClick={()=>void confirmTripDelete()}>Delete activity</button></div></div>}
 {mergeSource&&mergeTarget&&<div className="modal-backdrop" role="presentation"><div className="notice" role="dialog" aria-modal="true" aria-label="Merge journeys" style={{maxWidth:440,margin:'auto',padding:24}}><h2>Merge these activities?</h2><p>Combine the two selected journeys into one timeline while retaining the original GPS recordings and stops. You can undo this later.</p><p className="muted small-copy">Only consecutive activities from the same account can be merged; overlapping recordings and incompatible vehicles are excluded.</p>{grouping.error&&<p role="alert" className="error">{grouping.error}</p>}<div className="detail-actions"><button className="secondary" onClick={()=>{setMergeTarget(null);setMergeSource(null);}}>Cancel</button><button className="primary" disabled={grouping.busy} onClick={confirmMerge}>{grouping.busy?'Merging…':'Yes, merge'}</button></div></div></div>}
 {tab==='Social'&&<div className="social-layout social-redesign"><div className="social-sections" role="group" aria-label="Social sections"><button type="button" aria-pressed={socialSection==='friends'} onClick={()=>setSocialSection('friends')}>Friends</button><button type="button" aria-pressed={socialSection==='household'} onClick={()=>setSocialSection('household')}>Household</button></div>{socialSection==='friends'?<><Friends personPhotos={peopleAvatars.photos} selfId={session.user.id} selfAvatar={auth.preferences.avatar} selfName={auth.preferences.displayName||'You'} self={{...friendSelf,home:friendSelf.state==='live'&&selfAtHome,activity:presence.self?.activity_label||null}} sharing={{enabled:friendsLocation.enabled,ready:friendsLocation.ready!==false,error:friendsLocation.error,onChange:friendsLocation.setSharing}} permission={recording.state.permission} precise={recording.state.precise} locations={friendLocations} onShowPerson={showOnMap} onSetHome={()=>setSheet('places')} hasHome={Boolean(homePlace)} invitationCode={pendingInvitation?.kind==='friend'?pendingInvitation.code:null} onInviteConsumed={consumeInvitation} onShareLive={()=>friendsLocation.setSharing(true)}/><FriendTrips activities={grouping.journeys}/></>:<><Household invitationCode={pendingInvitation?.kind==='household'?pendingInvitation.code:null} onInviteConsumed={consumeInvitation} personPhotos={peopleAvatars.photos} selfId={session.user.id} selfAvatar={auth.preferences.avatar} onMembershipChanged={refreshHousehold} onShareLive={()=>presence.setLiveSharing(true)} onStopLive={()=>presence.setLiveSharing(false)} liveEnabled={presence.liveEnabled} liveReady={presence.liveReady} liveError={presence.liveError} onRetrySharing={presence.refreshLive} permission={recording.state.permission} precise={recording.state.precise} {...householdLocationProps} onShowMember={showOnMap} onOpenMap={openPeopleMap} vehicles={vehicles} onSaveVehicles={setVehicles} onSetHome={()=>setSheet('places')} hasHome={Boolean(homePlace)}/><HouseholdTrips activities={grouping.records}/></>}</div>}
 {tab==='Map'&&<div className={`map-explorer map-social-explorer map-page ${mapView.content==='routes'?'map-page-people':'map-page-trails'}`}>
 <h1 className="sr-only">Map</h1>
 <MapLayers open={layersOpen} view={mapView} onChange={setMapView} onClose={closeLayers} activities={mapActivities}/>
 {mapView.content==='trails'?<MtbMap currentPosition={mapLocation.position} onRecordTrail={recorderAvailable()&&recording.state.storageReady?recordTrail:null} onLayers={openLayers} layersActive={activeLayerCount(mapView)}/>:<>
 <JourneyMap journeys={mapJourneys} overview={overview} onLayers={openLayers} layersActive={activeLayerCount(mapView)} onJourney={journey=>{setSelected(journey);setTab('Trips');}} viewportKey={`${mapView.routes||'none'}:${mapView.activity}:${mapView.range}:${mapView.people}:${mapCenterVersion}`} camera={peopleOnMap?cameraIntent(camera,session.user.id,Boolean(overview)):null} onCamera={onMapCamera} onPhoto={openPhoto} peoplePins={peopleOnMap?mapPeople:[]} homePresence={(()=>{if(!peopleOnMap||!homePlace)return null;const placed=new Set(mapPeople.flatMap(pin=>pin.members.map(member=>member.name)));const names=presence.people.filter(p=>p.activity_label==='At home'&&!householdMembers.some(m=>m.user_id===p.user_id&&m.position)&&!placed.has(p.display_name)).map(p=>p.display_name);return names.length?{latitude:homePlace.latitude,longitude:homePlace.longitude,count:names.length,names}:null;})()} large {...(peopleOnMap?{}:{locating:mapLocation.loading,onLocate:async()=>{if(await mapLocation.locate())setMapCenterVersion(value=>value+1);}})}/>{mapLocation.error&&<p role="status" className="notice">{mapLocation.error}</p>}{peopleOnMap&&recorderAvailable()&&!['always','whenInUse'].includes(recording.state.permission)&&<p role="status" className="notice">Allow location access in iOS Settings to show yourself on the map. No earlier position is shown as current.</p>}{overview&&overview.included<overview.total&&<p className="muted small-copy">Route density from your {overview.included} most recent of {overview.total} journeys.</p>}{mapView.routes&&!mapJourneys.length&&<p className="muted small-copy" role="status">No routes match these layers.</p>}{overviewState.pending&&<p className="muted small-copy" role="status">Drawing routes…</p>}{overviewState.error&&<div className="notice" role="alert"><span>Routes could not be prepared. </span><button type="button" className="text-button" onClick={overviewState.retry}>Retry</button></div>}</>}</div>}

 {tab!=='Map'&&<footer className="page-footer"><span>Go somewhere. Keep the feeling.</span><span><Lock size={12}/> Your routes stay private</span></footer>}</div>}
 </main><MobileNav tab={tab} recordState={recordControlState(recording.state,recording.busy)} onSelect={name=>{setTab(name);setSelected(null);}}/>
 {sheet&&<div className="modal-backdrop" onClick={()=>setSheet(null)}><DismissibleSheet key={sheet} onClose={()=>setSheet(null)} label={sheet==='auth'?'Account access':sheet==='edit'?'Edit journey':sheet==='tracking'?'Tracking & Permissions':sheet==='diagnostics'?'Diagnostics':sheet==='garage'?'My Collection':sheet==='equipment'?'Activity equipment':sheet==='places'?'Saved places':sheet==='nativeEdit'?'Edit activity':sheet==='historical'?'Add past activity':'Your profile'}><button className="close icon-button" aria-label="Close dialog" onClick={()=>setSheet(null)}><X/></button>
 {sheet==='grouping'&&<JourneyGroupingPanel onReview={id=>{const trip=realJourneys.find(t=>t.id===id);if(trip){setSelected(trip);setSheet(null);}}} activities={realJourneys} grouping={grouping} onClose={()=>setSheet(null)}/>}
 {sheet==='profile'&&<><span className="sheet-icon"><ShieldCheck size={28}/></span><p className="eyebrow">YOUR LITTLE CORNER</p><h2>{auth.preferences.displayName||'Your private world.'}</h2><p className="muted">{session?.user.email||'Create an account to get ready for your own story.'}</p><div className="status-row"><Lock size={18}/><div><strong>Sharing & privacy</strong><p>Your routes are private. {presenceHidden?'Your live location is not shared.':'Location sharing is enabled.'} Choose who can see your location in Social.</p></div></div><div className="status-row"><Star size={18}/><div><strong>{saved.length} favourite activities</strong><p>Favourites help you find trips again. They do not change sharing permissions.</p></div></div><div className="profile-tools"><button className="secondary full" onClick={()=>setSheet('diagnostics')}><Gauge size={17}/> Diagnostics</button><button className="secondary full" onClick={()=>setSheet('garage')}><CarIcon size={17}/> My Collection</button></div><div className="profile-tools"><button className="secondary full" onClick={()=>setSheet('places')}><MapPin size={17}/> Saved places</button></div><button className="primary full" onClick={()=>setSheet('account')}>Account & settings <ArrowRight size={18}/></button><button type="button" className="secondary full" onClick={()=>setSheet('tracking')}>Tracking & Permissions</button><button className="secondary full" onClick={()=>setSheet('household')}>Household</button><small className="muted">Your activities remain private. Household setup does not enable location sharing.</small></>}
 {sheet==='places'&&<Places places={recording.state.places||[]} run={recording.run} busy={recording.busy} error={recording.error}/>}
 {['nativeEdit','historical'].includes(sheet)&&<ActivityEditor trip={selected} vehicles={vehicles} run={recording.run} busy={recording.busy} error={recording.error} historical={sheet==='historical'} onSaved={(result,id)=>{const trip=result.trips.find(t=>t.id===id);if(trip)setSelected(recordedJourney(trip));setSheet(null);}}/>}
 {sheet==='diagnostics'&&<Diagnostics state={recording.state} session={session} preferences={auth.preferences} run={recording.run} refresh={recording.refresh}/>}
 {sheet==='garage'&&<Garage vehicles={vehicles} onSave={setVehicles} tripCounts={equipmentTripCounts} onViewTrips={item=>{setEquipmentFilter(String(item.id));setSheet(null);setSelected(null);setTab('Trips');}}/>}
 {sheet==='equipment'&&equipmentTarget&&<EquipmentSheet key={equipmentTarget.id} trip={equipmentTarget} vehicles={vehicles} onAssign={assignEquipment} onAddItem={addCollectionItem} onClose={()=>setSheet(null)} busy={recording.busy}/>}
 {sheet==='account'&&<AccountSettings recording={recording} onTracking={()=>setSheet('tracking')}/>}
 {sheet==='tracking'&&<TrackingPermissions recording={recording} onBack={()=>setSheet('account')}/>}
 {sheet==='household'&&<Household personPhotos={peopleAvatars.photos} selfId={session.user.id} selfAvatar={auth.preferences.avatar} onMembershipChanged={refreshHousehold} onShareLive={()=>presence.setLiveSharing(true)} onStopLive={()=>presence.setLiveSharing(false)} liveEnabled={presence.liveEnabled} liveReady={presence.liveReady} liveError={presence.liveError} onRetrySharing={presence.refreshLive} permission={recording.state.permission} precise={recording.state.precise} {...householdLocationProps} onShowMember={showOnMap} onOpenMap={openPeopleMap} onSetHome={()=>setSheet('places')} hasHome={Boolean(homePlace)}/>}

{error&&<p role="alert" className="error">{error}</p>}</DismissibleSheet></div>}
 {lightbox&&<div className="lightbox" role="dialog" aria-modal="true" aria-label="Journey photographs" onClick={e=>{if(e.target===e.currentTarget)setLightbox(null);}}><button type="button" className="close icon-button" aria-label="Close photographs" onClick={()=>setLightbox(null)}><X/></button><div className="photo-zoom-viewport" onTouchStart={e=>{if(e.touches.length===2)photoPinch.current={distance:Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY),zoom:photoZoom};}} onTouchMove={e=>{if(e.touches.length===2&&photoPinch.current){e.preventDefault();const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);setPhotoZoom(Math.max(1,Math.min(5,photoPinch.current.zoom*d/photoPinch.current.distance)));}}} onTouchEnd={()=>{photoPinch.current=null;}}><PrivateImage className="zoomable-photo" style={{transform:`scale(${photoZoom})`}} onDoubleClick={()=>setPhotoZoom(z=>z>1?1:2)} src={lightbox.trip.photos[lightbox.index].url} alt={lightbox.trip.photos[lightbox.index].caption}/></div><div className="photo-zoom-controls"><button type="button" aria-label="Zoom out" disabled={photoZoom<=1} onClick={()=>setPhotoZoom(z=>Math.max(1,z-.5))}>−</button><span>{Math.round(photoZoom*100)}%</span><button type="button" aria-label="Zoom in" disabled={photoZoom>=5} onClick={()=>setPhotoZoom(z=>Math.min(5,z+.5))}>+</button><button type="button" onClick={()=>setPhotoZoom(1)}>Reset</button></div><p>{lightbox.trip.photos[lightbox.index].caption}</p><div><button className="icon-button" aria-label="Previous photo" disabled={lightbox.index===0} onClick={()=>{setPhotoZoom(1);setLightbox({...lightbox,index:lightbox.index-1});}}><ArrowLeft/></button><span>{lightbox.index+1} / {lightbox.trip.photos.length} · {lightbox.trip.source?'Private photo':'Demo photo'}</span><button className="icon-button" aria-label="Next photo" disabled={lightbox.index===lightbox.trip.photos.length-1} onClick={()=>{setPhotoZoom(1);setLightbox({...lightbox,index:lightbox.index+1});}}><ArrowRight/></button></div></div>}
 </div></>;
}
