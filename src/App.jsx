import {localJourneyRefs} from './lib/journeyGrouping.js';
import {useCloudJourneyPage} from './lib/useCloudJourneyPage.js';
import {useJourneyScope} from './lib/useJourneyScope.js';
import {activityFromCloudRow} from './lib/cloudActivity.js';
import {useSyncExternalStore} from 'react';
import {forgetActivityPhotos} from './lib/privateMedia.js';
import {localRecorderJourneys} from './lib/recorder.js';
import {deletionIDs} from './lib/tripsList.js';
import {householdActivity} from './lib/peopleMap.js';
import {activityLabel,activityCode,sameActivity} from './lib/activityNames.js';
import PersonAvatar from './components/PersonAvatar.jsx';
import {mapControls,panelChange,toolbarChange} from './lib/mapToolbar.js';
import {activeFilterCount,activityToolbar,canShiftForward,chosenDay,dateLabel,matchesDate,openDatePicker,shiftDate,DEFAULT_TRIP_DATE} from './lib/activityFilters.js';
import FilterToolbar from './components/FilterToolbar.jsx';
import {activityChoices,loadMapView,mapViewJourneys,saveMapView} from './lib/mapLayers.js';
import {useMapOverview} from './lib/useMapOverview.js';
import {useMapLocation} from './lib/useMapLocation.js';
import {usePeopleAvatars} from './lib/usePeopleAvatars.js';
import Friends from './components/Friends.jsx';
import {useSocialJourneyMap} from './lib/useSocialJourneyMap.js';
import {useSharedActivityFeed} from './lib/useSharedActivityFeed.js';
import {useMySharing} from './lib/useMySharing.js';
import {sharedActivityRow,filterActivityScope} from './lib/sharedActivityRows.js';
import HouseholdTrips from './components/HouseholdTrips.jsx';
import {useHouseholdPresence} from './lib/useHouseholdPresence.js';
import {LIVE_SECONDS,atHome,memberLocationState,peoplePins,memberActivities} from './lib/householdLocation.js';
import {useHomePresence} from './lib/useHomePresence.js';
import {cameraIntent,cameraReducer,initialCamera,shouldFocusSelf} from './lib/mapCamera.js';
import {secondsAtPlace} from './lib/peopleMap.js';
import {useFriendLocations} from './lib/useFriendLocations.js';
import {useFleetJourneys} from './lib/useFleetJourneys.js';
import {useJourneyGrouping} from './lib/useJourneyGrouping.js';
import {createJourneySync} from './lib/journeyMetadataStore.js';
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
import {distanceText,tripDistanceText} from './lib/distanceUnits.js';
import { setNativeAppearance } from './lib/appleMaps.js';
import TrackingPermissions from './components/TrackingPermissions.jsx';
import {RecordingHealthChip,RecordingHealthDetail,RecordingWarning} from './components/RecordingHealth.jsx';
import {useRecordingWarning} from './lib/useRecordingWarning.js';
import BrandMark from './components/BrandMark.jsx';
import DismissibleSheet from './components/DismissibleSheet.jsx';
import PrivateImage from './components/PrivateImage.jsx';
import EquipmentSheet from './components/EquipmentSheet.jsx';
import {EquipmentChip} from './components/EquipmentChip.jsx';
import {equipmentTripCount,equipmentUsage,itemTitle,tripEquipmentLabel,tripUsesEquipment} from './lib/collection.js';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { CircleDot, Users, Gauge, Car as CarIcon, ArrowUpRight, ArrowLeft, ArrowRight, Star, ChevronRight, Home, MapPin, Plus, Search, ShieldCheck, SlidersHorizontal, Sun, Moon, User, X, Route, Lock, GitMerge, EyeOff, Eye, LifeBuoy, Share2 } from 'lucide-react';
import JourneyMap from './components/JourneyMap.jsx';
import SegmentsView from './components/SegmentsView.jsx';
import SegmentDetail from './components/SegmentDetail.jsx';
import HeaderAvatar from './components/HeaderAvatar.jsx';
import NotificationList from './components/NotificationList.jsx';
import {areaAround,useSegmentMapLayer} from './lib/segmentsApi.js';
import RecorderPanel from './components/RecorderPanel.jsx';
import Diagnostics from './components/Diagnostics.jsx';
import FeedbackSupport from './components/FeedbackSupport.jsx';
import PokeOverlay from './components/PokeOverlay.jsx';
import {useNotifications,countKinds,sendPoke,FEEDBACK_KINDS} from './lib/notifications.js';
import {enableAccountPush} from './lib/pushAccount.js';
import {Capacitor} from '@capacitor/core';
import Garage from './components/Garage.jsx';
import Places from './components/Places.jsx';
import ActivityDetailScreen from './components/ActivityDetailScreen.jsx';
import HouseholdRequests from './components/HouseholdRequests.jsx';
import PeopleGrid from './components/PeopleGrid.jsx';
import HomeDailySummary from './components/HomeDailySummary.jsx';
import {homeJourneysForDay} from './lib/homeDailyStats.js';
import {homePeople} from './lib/homePeople.js';
import ActivityEditor from './components/ActivityEditor.jsx';
import SharedActivityDetail from './components/SharedActivityDetail.jsx';
import { AuthProvider, useAuth } from './lib/AuthContext.jsx';
import AuthScreen from './components/AuthScreen.jsx';
import Onboarding from './components/Onboarding.jsx';
import AccountSettings from './components/AccountSettings.jsx';
import Household from './components/Household.jsx';
import { useRecorder } from './lib/useRecorder.js';
import { recorderAvailable, recordedJourney, visibleRecorderJourneys } from './lib/recorder.js';
const HOME_PEOPLE=6;
// One empty list, so a missing places value does not look like a change on every render.
const NO_PLACES=[];
const activities=['All activities','Unknown','Cycling','MTB','Hiking','Walking','Running','Road cycling','Kitesurfing','Driving','Gym','Other'];
export default function App(){
 useEffect(()=>{const theme=localStorage.getItem('letm3go-theme')==='dark'?'dark':'light';document.documentElement.dataset.theme=theme;void setNativeAppearance(theme).catch(()=>{});},[]);
 const token=new URLSearchParams(window.location.search).get('journey');
 return token?<SharedActivityDetail token={token} onBack={()=>{window.location.href=window.location.pathname;}}/>:<AuthProvider><AuthGate/></AuthProvider>;
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
 const [motionClock,setMotionClock]=useState(()=>Date.now());
 useEffect(()=>{
  const updateClock=()=>setMotionClock(Date.now());
  const interval=setInterval(updateClock,15000);
  document.addEventListener('visibilitychange',updateClock);
  return()=>{clearInterval(interval);document.removeEventListener('visibilitychange',updateClock);};
 },[]);
 const automaticPresenceActivity=householdActivity(recording.state,motionClock/1000);
 const presence=useHouseholdPresence(session.user.id,auth.status==='authenticated',automaticPresenceActivity,recording.state.places||NO_PLACES,recording.state.nativeFamilySharing?.lastUploadOkAt||0);
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
 const localTimeZone=Intl.DateTimeFormat().resolvedOptions().timeZone;
 const localProjectionCache=useMemo(()=>({owner:session.user.id,timeZone:localTimeZone,values:new WeakMap()}),[session.user.id,localTimeZone]);
 const realJourneys=useMemo(()=>localRecorderJourneys({ownerID:recording.state.ownerID,trips:recording.state.trips},session.user.id,localProjectionCache.values),[recording.state.trips,recording.state.ownerID,session.user.id,localProjectionCache]);
 const localGroupingActivities=useMemo(()=>realJourneys.filter(t=>!t.provisional).concat(fleet.activities),[realJourneys,fleet.activities]);
 // One cache of Supabase's journey metadata per account (read-only; edits go to Supabase
 // first). A leftover copy from earlier builds in the preferences file is cleared once.
 // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt only when the account changes
 const journeySync=useMemo(()=>createJourneySync({owner:session.user.id,preferences:auth.preferences,savePreferences:auth.savePreferences}),[session.user.id]);
 useEffect(()=>{void journeySync.ready().catch(()=>{});},[journeySync]);
 useSyncExternalStore(journeySync.subscribe,journeySync.getSnapshot);


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
 const [deleteTrip,setDeleteTrip]=useState(null),[deleteError,setDeleteError]=useState('');
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
 useEffect(()=>{forgetActivityPhotos(recording.state.deletedIDs||[],recording.state.ownerID||session.user.id);},[recording.state.deletedIDs,recording.state.ownerID,session.user.id]);
 function clearDeletedPreferences(ids){
  forgetActivityPhotos(ids,session.user.id);
  const removed=new Set(ids);
  void auth.savePreferences({bookmarks:saved.filter(id=>!removed.has(id)),archivedTrips:archivedTrips.filter(id=>!removed.has(id))}).catch(()=>setError('Activity deleted. Saved filters could not be updated.'));
 }
 async function confirmTripDelete(){
  if(!deleteTrip||recording.busy)return;
  const ids=deletionIDs(deleteTrip);if(!ids.length)return;setDeleteError('');
  const result=await recording.run(ids.length===1?'deleteActivity':'deleteActivities',ids.length===1?ids[0]:ids);
  if(result){clearDeletedPreferences([...ids,deleteTrip.id]);setDeleteTrip(null);setSelected(null);}else setDeleteError('Could not delete every selected activity. Retry safely or cancel.');
 }
 const [metricView,setMetricView]=useState(null);
 const [socialSection,setSocialSection]=useState('friends');
 const [includeSharedActivities,setIncludeSharedActivities]=useState(false);
 const [socialMapEnabled,setSocialMapEnabled]=useState(false),[openSocialJourney,setOpenSocialJourney]=useState(null);
 const socialMap=useSocialJourneyMap(socialMapEnabled,session.user.id);
 const [pendingInvitation,setPendingInvitation]=useState(()=>{try{return JSON.parse(sessionStorage.getItem('letm3go:pending-invitation')||'null');}catch{return null;}});
 // What the Map shows (map, people, routes, filters), kept per account so it
 // survives tab changes and relaunches.
 const [mapView,setMapView]=useState(()=>loadMapView(session.user.id));
 useEffect(()=>{saveMapView(session.user.id,mapView);},[session.user.id,mapView]);
 // The open Map panel, never saved: 'filters', 'layers' or null.
 const [mapPanel,setMapPanel]=useState(null);
 const mapAction=useCallback(id=>{
  if(id.startsWith('panel:'))setMapPanel(previous=>panelChange(previous,id));
  else setMapView(previous=>toolbarChange(previous,id));
 },[]);

 // Show everyone, follow a person or explore freely (see lib/mapCamera.js).
 const [camera,dispatchCamera]=useReducer(cameraReducer,initialCamera);
 const [tripSearchOpen,setTripSearchOpen]=useState(false);
 const [tripFiltersOpen,setTripFiltersOpen]=useState(false);
 const [tripFilterCategory,setTripFilterCategory]=useState(null);
 const closeTripFilters=useCallback(()=>setTripFiltersOpen(false),[]);
 const [tripActionsOpen,setTripActionsOpen]=useState(false);
 const [equipmentFilter,setEquipmentFilter]=useState('');
 const [equipmentTarget,setEquipmentTarget]=useState(null);
 const tripSearchRef=useRef(null);
 const tripDateInput=useRef(null);

 const recordingWarning=useRecordingWarning();
 const [homeDay,setHomeDay]=useState('today');
 const [tab,setTab]=useState(familySetup?'Social':'Home'),[selected,setSelected]=useState(null),[sheet,setSheet]=useState(null),[query,setQuery]=useState(''),[filter,setFilter]=useState('All activities'),[dayFilter,setDayFilter]=useState(DEFAULT_TRIP_DATE),[sortPreference,setSortPreference]=useState(()=>{const saved=localStorage.getItem('letm3go-trip-sort');return ['newest','distance','duration'].includes(saved)?saved:'newest';}),[favouritesOnly,setFavouritesOnly]=useState(false),[error,setError]=useState(''),[lightbox,setLightbox]=useState(null),[theme,setTheme]=useState(()=>localStorage.getItem('letm3go-theme')||'light');
 // The Segments layer loads only the settled visible area, only while the Map shows it.
 const [mapArea,setMapArea]=useState(null);
 // Notifications: the badge on your profile bubble, push taps and pokes.
 // Activities | Segments, and the one segment details sheet (library, Map, notifications).
 const [activitiesView,setActivitiesView]=useState('activities'),[openSegment,setOpenSegment]=useState(null);
 // Bumped when a segment is edited or deleted, so the Map layer and the library reload.
 const [segmentsVersion,setSegmentsVersion]=useState(0);
 const segmentsChanged=useCallback(()=>setSegmentsVersion(n=>n+1),[]);
 const openSegmentDetail=useCallback(id=>{setOpenSegment(id);setSheet('segment');},[]);
 const openNotification=useCallback(target=>{
  setSelected(null);
  if(target.screen==='feedback')setSheet('feedback');
  else if(target.screen==='segment'){setTab('Trips');setActivitiesView('segments');setOpenSegment(target.id);setSheet('segment');}
  else{setSheet(null);setTab('Home');}
 },[]);
 const inbox=useNotifications(session.user.id,{onOpen:openNotification});
 const {markRead}=inbox;
 const feedbackUnread=countKinds(inbox.items,FEEDBACK_KINDS);
 const incomingPoke=inbox.items.find(item=>item.kind==='poke')||null;
 const dismissPoke=useCallback(()=>void markRead(['poke']),[markRead]);
 useEffect(()=>{if(sheet==='feedback')void markRead(FEEDBACK_KINDS);},[sheet,markRead]);
 // Ask once, after sign-in on the iPhone; Account settings can turn it on later.
 useEffect(()=>{
  if(!Capacitor.isNativePlatform()||auth.preferences.notificationsEnabled||localStorage.getItem('letm3go-push-asked'))return undefined;
  const timer=setTimeout(async()=>{
   localStorage.setItem('letm3go-push-asked','1');
   try{const result=await enableAccountPush(session.user.id,()=>{});if(result.enabled)await auth.savePreferences({notificationsEnabled:true});}catch{/* Account settings shows the retry */}
  },4000);
  return()=>clearTimeout(timer);
 // eslint-disable-next-line react-hooks/exhaustive-deps -- asked once per installation
 },[session.user.id,auth.preferences.notificationsEnabled]);
 const [pokeNotice,setPokeNotice]=useState(null);
 const journalDate=tab==='Trips'?(tripSearchOpen&&query.trim()?'all':dayFilter):tab==='Map'?(mapView.routes==='today'?'today':mapView.day||(/d$/.test(mapView.range)?mapView.range:'all')):homeDay;
 const cloudJournal=useCloudJourneyPage({owner:session.user.id,sync:journeySync,date:journalDate,query:tab==='Trips'?query:'',activity:tab==='Trips'?filter:tab==='Map'?mapView.activity||'All activities':'All activities',sort:tab==='Trips'?sortPreference:'newest',equipment:tab==='Trips'?equipmentFilter:null,favourites:tab==='Trips'&&favouritesOnly?saved:null,archived:archivedTrips,showArchived:tab==='Trips'&&showArchived});
 const localIDs=useMemo(()=>localGroupingActivities.filter(trip=>matchesDate(trip,journalDate,new Date().toLocaleDateString('en-CA'))).sort((a,b)=>b.startedAt-a.startedAt).slice(0,50).map(trip=>trip.id),[localGroupingActivities,journalDate]);
 const detailIDs=useMemo(()=>{
  const ids=selected?.isGroupedJourney?(selected.segments||[]).flatMap(trip=>trip.sourceRecords?.map(s=>s.id)||[trip.id]):selected?.sourceRecords?.map(s=>s.id)|| (selected?[selected.id]:[]);
  return [...new Set(ids.flatMap(id=>id.startsWith('linked:')?[id,id.slice(7)]:[id]))];
 },[selected]);
 const contextIDs=[...new Set([...detailIDs,...(mapView.routes==='pinned'?saved.slice(0,100).map(id=>id.replace(/^journey:/,'')):[]),...cloudJournal.ids,...localIDs])].slice(0,200);
 const contextInput=JSON.stringify(contextIDs);
 const contextEdges=JSON.stringify([journeySync.read().metadata?.links||[],journeySync.read().metadata?.sourceLinks||[]]);
 const localContext=useMemo(()=>{const [links,sourceLinks]=JSON.parse(contextEdges);return localJourneyRefs(localGroupingActivities,JSON.parse(contextInput),{links,sourceLinks});},[localGroupingActivities,contextInput,contextEdges]);
 const rows=journeySync.read().activityRows;
 const visibleScopes=Object.values(journeySync.read().cache?.scopes||{}).filter(scope=>scope.ids.some(id=>contextIDs.includes(id)));
 const knownIDs=[...new Set([...contextIDs,...localContext.ids,...visibleScopes.flatMap(scope=>scope.ids)])];
 const mapDetailIDs=tab==='Map'&&mapView.routes?knownIDs.filter(id=>rows?.[id]&&!realJourneys.some(trip=>trip.id===id)).slice(0,10):[];
 const sourceDetailIDs=selected?knownIDs.filter(id=>{
  const row=rows?.[id];return row&&((row.recording_mode==='tesla')!==(selected.source==='tesla'))&&Date.parse(row.started_at)/1000<=selected.endedAt&&Date.parse(row.ended_at)/1000>=selected.startedAt;
 }):[];
 const requestedDetails=[...new Set([...detailIDs,...sourceDetailIDs,...mapDetailIDs])];
 const scopeState=useJourneyScope({owner:session.user.id,sync:journeySync,refs:contextIDs,details:requestedDetails,localDetailIDs:knownIDs.filter(id=>localGroupingActivities.some(trip=>trip.id===id))});
 const contextKey=JSON.stringify(knownIDs),detailKey=JSON.stringify(requestedDetails);
 const groupingActivities=useMemo(()=>{
  const local=new Map(localGroupingActivities.map(trip=>[trip.id,trip]));
  const detailed=new Set(JSON.parse(detailKey));
  return JSON.parse(contextKey).flatMap(id=>{
   if(local.has(id))return [local.get(id)];
   if(!rows?.[id])return [];
   return [activityFromCloudRow(rows[id],{detail:detailed.has(id)&&Array.isArray(rows[id].route_points)})];
  });
 },[localGroupingActivities,rows,contextKey,detailKey]);
 const cloudPlaces=journeySync.read().savedPlaces;
 const projectionPlaces=useMemo(()=>[...new Map([...(cloudPlaces||[]),...(recording.state.places||NO_PLACES)].map(place=>[place.id,place])).values()],[cloudPlaces,recording.state.places]);
 const grouping=useJourneyGrouping({owner:session.user.id,activities:groupingActivities,processingActivities:realJourneys,telemetry:fleet.charges,places:projectionPlaces,vehicles,metadataValue:journeySync.read().metadata,receipts:auth.preferences.syncReceipts,sync:journeySync});
 const sharedFeed=useSharedActivityFeed(tab==='Trips'&&includeSharedActivities,session.user.id);
 // Who can see my shared activities: reloaded when an activity's details close.
 const mySharing=useMySharing(tab==='Trips',session.user.id,selected?.id??'list');
 // The open Map panel closes with the page, like any other transient control.
 const [panelTab,setPanelTab]=useState(tab);
 if(panelTab!==tab){setPanelTab(tab);setMapPanel(null);}
 const mapLocation=useMapLocation(session.user.id,tab==='Map'||tab==='Home',recording.state.permission);
 // Until the map reports its area (after the first move), start around you.
 const mapSegments=useSegmentMapLayer(tab==='Map'&&mapView.segments,mapArea||areaAround(mapLocation.position,5),undefined,segmentsVersion);
 const focusedSelf=useRef(false);
 const mapHasSelf=Boolean(tab==='Map'&&mapView.content==='routes'&&mapView.people&&mapLocation.position);
 useEffect(()=>{
  if(!mapHasSelf||focusedSelf.current)return;
  focusedSelf.current=true;
  if(shouldFocusSelf(camera,{visible:true,hasPosition:true}))dispatchCamera({type:'focus',personId:'self'});
 },[mapHasSelf,camera]);
 // People on the map and in Household: one state per person from one policy.
 const homePlace=useMemo(()=>projectionPlaces.find(p=>p.kind==='home')||null,[projectionPlaces]);
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
 const sharedActivities=useMemo(()=>memberActivities(presence.people,presence.liveMembers),[presence.people,presence.liveMembers]);
 // Your own time at a place, as your household sees it, and only while your
 // shared position is current, so it never outlives what was actually published.
 const selfArrival=presence.selfArrival;
 const selfSeconds=presence.liveEnabled&&selfArrival?.location_at&&Date.parse(selfArrival.server_now)-Date.parse(selfArrival.location_at)<=LIVE_SECONDS*1000?secondsAtPlace({...selfArrival,state:'live'}):null;
 const savedPlaces=recording.state.places;
 const mapPeople=useMemo(()=>peoplePins({
  self:mapLocation.position?{latitude:mapLocation.position.latitude,longitude:mapLocation.position.longitude,accuracy:mapLocation.position.accuracy,name:auth.preferences.displayName||'You',home:homeFlags.self===true,seconds:selfSeconds,activity:automaticPresenceActivity}:null,
  members:mapView.people?[...householdMembers.map(m=>({...m,home:homeFlags[m.user_id]===true})),...friendMembers]:[],
  photos:peopleAvatars.photos,selfId:session.user.id,selfAvatar:auth.preferences.avatar,places:savedPlaces||[],activities:sharedActivities,nowMs:motionClock
 }),[mapView.people,mapLocation.position,householdMembers,friendMembers,homeFlags,peopleAvatars.photos,session.user.id,auth.preferences.avatar,auth.preferences.displayName,selfSeconds,automaticPresenceActivity,savedPlaces,sharedActivities,motionClock]);
 // What the household sees of you: confirmed sends, not just the switch.
 const selfSharedAt=Math.max(presence.lastPublishedAt||0,(recording.state.nativeFamilySharing?.lastUploadOkAt||0)*1000);
 const selfLocationState=!presence.liveEnabled?{state:'off',ageSeconds:null}:
  selfSharedAt?{state:motionClock-selfSharedAt<=LIVE_SECONDS*1000?'live':'stale',ageSeconds:Math.max(0,Math.round((motionClock-selfSharedAt)/1000))}:{state:'waiting',ageSeconds:null};
 // You are "At home" in Social only with a current position of your own (the map
 // keeps its last fix after you leave the Map tab, which may be old).
 const selfFix=mapLocation.position;
 const selfAtHome=homeFlags.self===true&&Boolean(selfFix)&&Number.isFinite(selfFix.timestamp)&&motionClock/1000-selfFix.timestamp<=LIVE_SECONDS;
 const householdLocationProps=useMemo(()=>({
  memberLocations:Object.fromEntries(householdMembers.map(m=>[m.user_id,{state:m.state,ageSeconds:m.ageSeconds,position:m.position,home:homeFlags[m.user_id]===true&&m.state==='live',verifiedHome:m.state==='stale'&&atHome(false,m.position,homePlace),activity:sharedActivities[m.user_id]||null}])),
  selfLocation:{state:selfLocationState.state,ageSeconds:selfLocationState.ageSeconds,home:selfLocationState.state==='live'&&selfAtHome,activity:presence.self?.activity_label||null}
 }),[householdMembers,homeFlags,homePlace,sharedActivities,selfLocationState.state,selfLocationState.ageSeconds,selfAtHome,presence.self?.activity_label]);
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
 // Tapping a friend on Home pokes them; the confirmation still offers the map.
 const pokePerson=useCallback(async person=>{
  const name=person.name||'them';
  try{await sendPoke(person.userId);setPokeNotice({text:`Poked ${name} 👋`,person});}
  catch(error){setPokeNotice({text:error.message||`Could not poke ${name}.`,person,failed:true});}
 },[]);
 useEffect(()=>{if(!pokeNotice)return undefined;const timer=setTimeout(()=>setPokeNotice(null),4000);return()=>clearTimeout(timer);},[pokeNotice]);
 const homeFriends=useMemo(()=>homePeople({household:householdMembers,friends:friendMembers,selfID:session.user.id,selfPosition:mapLocation.position,homeFlags,homePlace,activities:sharedActivities,unit}).slice(0,HOME_PEOPLE).map(person=>({...person,onSelect:()=>void pokePerson(person),actionLabel:`Poke ${person.name||'them'}.`})),[householdMembers,friendMembers,session.user.id,mapLocation.position,homeFlags,homePlace,sharedActivities,unit,pokePerson]);
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
 async function addCollectionItem(item){
  try{await setVehicles([...vehicles,item]);return true;}catch{return false;}
 }
 const selectedJourney=selected?.isGroupedJourney?visibleJourneys.find(j=>j.id===selected.id):null;
 const selectedActivity=selected&&!selected.isGroupedJourney?(visibleJourneys.find(j=>j.id===selected.id)||realJourneys.find(j=>j.id===selected.id)||selected):null;
 const today=new Date().toLocaleDateString('en-CA');
 const mapJourneys=useMemo(()=>mapViewJourneys(grouping.journeys,mapView,today,saved,archivedTrips),[grouping.journeys,mapView,today,saved,archivedTrips]);
 const combinedMapJourneys=useMemo(()=>socialMapEnabled?[...socialMap.journeys.slice(0,15),...mapJourneys.slice(0,35)]:mapJourneys,[mapJourneys,socialMapEnabled,socialMap.journeys]);
 const mapActivities=useMemo(()=>activityChoices(grouping.journeys),[grouping.journeys]);
 // The route overview: a density map of every shown journey (not only the 50
 // most recent) with clustered photos. Rebuilt only when the journeys change.
 const overviewState=useMapOverview(mapJourneys,{enabled:tab==='Map'&&mapView.content==='routes'&&Boolean(mapView.routes),unit});
 const overview=overviewState.overview;
 const peopleOnMap=mapView.content==='routes'&&mapView.people;
 // Typed search covers all history. The date stays selected and returns with the
 // search cleared; until then the date row steps aside and the results say so.
 const searchingAllDates=tripSearchOpen&&Boolean(query.trim());
 const [dateChosen,setDateChosen]=useState(false);
 const tripFilterState={activity:filter,date:dayFilter,favourites:favouritesOnly,archived:showArchived,equipment:activeEquipmentFilter};
 // Today is where the tab opens, not a filter someone chose: it does not count as
 // one, and filtering by anything else looks across every date.
 const activeTripFilters=activeFilterCount({...tripFilterState,date:dateChosen?dayFilter:'all'});
 const widenDefaultDate=()=>{if(!dateChosen)setDayFilter('all');};
 const tripToolbar=activityToolbar({...tripFilterState,open:tripFiltersOpen,category:tripFilterCategory,activities,archivedCount:archivedTrips.length,sort,equipmentOptions:equipmentOptions.map(({item,count})=>({id:String(item.id),name:itemTitle(item),count})),today});
 function resetTripFilters(){setQuery('');setFilter('All activities');setDayFilter('all');setFavouritesOnly(false);setEquipmentFilter('');if(showArchived){setShowArchived(false);setLastArchived(null);}}
 function tripFilterAction(id){
  if(['date','activity','sort','equipment'].includes(id)){setTripFilterCategory(previous=>previous===id?null:id);return;}
  if(id==='favourites'){widenDefaultDate();setFavouritesOnly(value=>!value);return;}
  if(id==='archived'){widenDefaultDate();setShowArchived(value=>!value);setLastArchived(null);return;}
  if(id==='reset'){resetTripFilters();return;}
  const [kind,...rest]=id.split(':'),value=rest.join(':');
  if(kind==='date'){setDateChosen(true);setDayFilter(value);}
  else if(kind==='activity'){widenDefaultDate();setFilter(value);}
  else if(kind==='equipment'){widenDefaultDate();setEquipmentFilter(value);}
  else if(kind==='sort'){setSortPreference(value);localStorage.setItem('letm3go-trip-sort',value);setMetricView(null);}
 }
 const sharedRows=useMemo(()=>sharedFeed.items.map(item=>sharedActivityRow(item,item.owner_name||'Friend')).filter(Boolean),[sharedFeed.items]);
 const activityRows=useMemo(()=>filterActivityScope(visibleJourneys,sharedRows,includeSharedActivities),[visibleJourneys,sharedRows,includeSharedActivities]);
 const filtered=useMemo(()=>activityRows.filter(t=>
  (t.isShared?(!showArchived&&!favouritesOnly&&!activeEquipmentFilter):(showArchived?archivedTrips.includes(t.id):!archivedTrips.includes(t.id))&&(!favouritesOnly||saved.includes(t.id)))&&
  (searchingAllDates||matchesDate(t,dayFilter,today))&&
  (filter==='All activities'||sameActivity(t.activity,filter))&&
  (!activeEquipmentFilter||tripUsesEquipment(t,vehicles,activeEquipmentFilter))&&
  `${t.searchIndex||''} ${activityLabel(t.activity)} ${activityCode(t.activity)} ${t.title} ${t.ownerName||''} ${t.location||''} ${t.date} ${t.collection||''} ${t.notes||''} ${(t.tags||[]).join(' ')} ${t.isShared?'Shared':''} ${t.isShared?'':tripEquipmentLabel(t,vehicles)}`.toLowerCase().includes(query.toLowerCase())
 ).sort((a,b)=>sort==='duration'?b.durationSeconds-a.durationSeconds||b.startedAt-a.startedAt:sort==='distance'?b.distanceMeters-a.distanceMeters||b.startedAt-a.startedAt:b.startedAt-a.startedAt),
 [activityRows,showArchived,archivedTrips,favouritesOnly,saved,searchingAllDates,query,dayFilter,today,filter,activeEquipmentFilter,vehicles,sort]);
 const confirmMerge=async()=>{
  if(!mergeSource||!mergeTarget)return;
  const expand=id=>{const trip=grouping.journeys.find(t=>t.id===id);return trip?.isGroupedJourney?trip.segmentIDs:[id];};
  const pair=[...new Set([...expand(mergeSource),...expand(mergeTarget)])];
  const success=await grouping.act({type:'merge',ids:pair});
  if(success){setMergeSource(null);setMergeTarget(null);}
 };
 // Use the same visible, non-household activities as the Activities list.
 // Match the default Activities list: archived and household journeys are excluded.
 const homeJourneys=useMemo(()=>homeJourneysForDay(visibleJourneys,archivedTrips,homeDay,today),[visibleJourneys,archivedTrips,homeDay,today]);
 const openHomeDay=day=>{
  setQuery('');setFilter('All activities');setDateChosen(true);setDayFilter(day);
  setMetricView(null);setFavouritesOnly(false);setEquipmentFilter('');setShowArchived(false);
  setTripSearchOpen(false);setTripFiltersOpen(false);setTripFilterCategory(null);
  setSelected(null);setTab('Trips');
 };
  return <><AutoCloudSync state={recording.state} journeySync={journeySync}/><PokeOverlay poke={incomingPoke} onDismiss={dismissPoke}/>{pokeNotice&&<div className="poke-layer" role="status" aria-live="polite"><div className={`poke-toast ${pokeNotice.failed?'poke-toast--failed':''}`}><span className="poke-toast-text">{pokeNotice.text}</span>{pokeNotice.person.position&&<button type="button" className="poke-toast-action" onClick={()=>{const {position,userId}=pokeNotice.person;setPokeNotice(null);showOnMap(position,userId);}}>Show on map</button>}</div></div>}<div className="app-shell"><aside className="desktop-rail"><a className="brand" href="#" onClick={e=>{e.preventDefault();setSelected(null);setTab('Home');}} aria-label="Letm3go Home"><AnimatedWordmark/></a><p className="rail-caption">MAKE ROOM FOR ADVENTURE</p><nav>{NAV_ITEMS.map(({name})=><NavButton key={name} name={name} active={tab===name&&!selected} onSelect={()=>{setTab(name);setSelected(null);}}/>)}</nav><div className="rail-bottom"><div className="private-note"><ShieldCheck size={22}/><strong>Your story. Your choice.</strong><p>Your journeys are private until you choose to share.</p></div><button className="profile-link" onClick={()=>setSheet('profile')}><span className="avatar"><User size={20}/></span><div><strong>{session?'Your account':'Your adventure starts here'}</strong><small>{session?'Manage profile':'Private local activities'}</small></div><ChevronRight size={16}/></button></div></aside>
  <main>{error&&<p role="alert" className="error">{error}</p>}{recording.error&&<p role="alert" className="error">{recording.error}</p>}{auth.status==='offline'&&<p className="notice">Offline · Private recordings stay on this device. Cloud actions require reconnection.</p>}<header className="topbar"><span className="mobile-brand"><AnimatedWordmark/></span><div className="breadcrumb">Your world, a little closer.</div><div className="top-actions"><button className="icon-button" aria-label="Toggle dark theme" onClick={()=>setTheme(theme==='dark'?'light':'dark')}>{theme==='dark'?<Sun size={20}/>:<Moon size={20}/>}</button><HeaderAvatar count={inbox.count} onOpen={()=>setSheet('profile')}><PersonAvatar name={auth.preferences.displayName||'You'} userId={session.user.id} selfId={session.user.id} selfAvatar={auth.preferences.avatar} photos={peopleAvatars.photos} size="sm"/></HeaderAvatar></div></header>
 <RecordingWarning health={recording.state.recordingHealth} run={recording.run} warning={recordingWarning} tab={tab} recording={recording.state.active?.state==='recording'}/>
 {recording.state.active&&<button type="button" className="active-recording-banner" onClick={()=>{setSelected(null);setSheet(null);setTab("Record");}} aria-label="Return to active recording"><span className="live-dot"/><strong>{activityLabel(recording.state.active.activity)} · {recording.state.active.state==="recording"?"Recording": "Paused"}</strong><span>Continue exploring · tap to view recording</span><ArrowRight size={17}/></button>}
 {selected&&scopeState.loading&&!realJourneys.some(trip=>trip.id===selected.id)?<p role="status">Loading saved journey details…</p>:selected&&scopeState.error&&!realJourneys.some(trip=>trip.id===selected.id)?<div className="notice" role="alert"><p>{scopeState.error}</p><button onClick={()=>setSelected(null)}>Back to activities</button></div>:openSocialJourney?<SharedActivityDetail activityID={openSocialJourney} ownerName={sharedRows.find(row=>row.sharedActivityID===openSocialJourney)?.ownerName||'Friend'} ownerID={session.user.id} unit={unit} onBack={()=>setOpenSocialJourney(null)}/>:selectedJourney?<GroupedJourneyDetail ownerID={session.user.id} unit={unit} key={selectedJourney.id} trip={selectedJourney} vehicles={vehicles} onAddEquipment={addCollectionItem} grouping={grouping} activities={realJourneys} places={recording.state.places||NO_PLACES} recording={recording} onBack={()=>setSelected(null)} onPhoto={openPhoto} onEdit={trip=>{setSelected(trip);setSheet('nativeEdit');}}/>:selected&&!selected.isGroupedJourney?<ActivityDetailScreen ownerID={session.user.id} unit={unit} key={`${selected.id}:${selectedActivity?.state||'finished'}`} trip={selectedActivity} journeys={groupingActivities} vehicles={vehicles} onEquipment={openEquipment} onAddEquipment={addCollectionItem} onStopChange={grouping.act} grouping={grouping} onSource={setSelected} places={recording.state.places||NO_PLACES} onBack={()=>setSelected(null)} onEdit={()=>setSheet('nativeEdit')} onPhoto={openPhoto} run={recording.run} lastError={recording.lastError} onUpdated={setSelected} onDeleted={()=>{clearDeletedPreferences([selectedActivity.id]);setSelected(null);}} busy={recording.busy} error={recording.error}/>
:<div className="page-enter">
 {tab==='Trips'?<div className="trip-journal-heading"><h1>Activities</h1>{activitiesView==='activities'&&<div className="trip-heading-actions"><button type="button" className="trip-round-action" aria-label={tripSearchOpen?'Close activity search':'Search all activities'} aria-expanded={tripSearchOpen} onClick={()=>{if(tripSearchOpen)setQuery('');setTripSearchOpen(v=>!v);setTripActionsOpen(false);}}>{tripSearchOpen?<X size={20}/>:<Search size={20}/>}</button><button type="button" className="trip-round-action" aria-label={activeTripFilters?`Activity filters, ${activeTripFilters} active`:'Activity filters'} aria-expanded={tripFiltersOpen} onClick={()=>{setTripFiltersOpen(v=>!v);setTripActionsOpen(false);}}><SlidersHorizontal size={20}/>{activeTripFilters>0&&<span className="trip-filter-count" aria-hidden="true">{activeTripFilters}</span>}</button><button type="button" className="trip-round-action" aria-label="More activity actions" aria-expanded={tripActionsOpen} onClick={()=>{setTripActionsOpen(v=>!v);setTripFiltersOpen(false);}}><Plus size={21}/></button></div>}</div>:tab==='Map'?null:<div className="page-heading"><div><p className="eyebrow">{tab==='Home'?'YOUR DAY, OUT THERE':tab==='Record'?'REAL GPS · PRIVATE BY DEFAULT':tab==='Social'?'YOUR PEOPLE':'YOUR RECORDED WORLD'}</p><h1>{tab==='Home'?'Your day. Your way.':tab==='Record'?'Record an activity.':tab==='Social'?'Your people.':'Your world, mapped.'}</h1><p className="muted">{tab==='Home'?'A little movement. A little perspective. Your day at a glance.':tab==='Record'?'Start here. Keep recording with the screen locked where iOS permits.':tab==='Social'?(presence.liveEnabled||friendsLocation.enabled?'Live sharing is on. You can turn it off any time.':'Connect with people. Share live only when you choose.'):'Explore your routes and places.'}</p></div></div>}
 {tab==='Home'&&<><RecordingHealthChip health={recording.state.recordingHealth} onOpen={()=>setSheet('recordingHealth')}/><HomeDailySummary date={homeDay} today={today} journeys={homeJourneys} unit={unit} onDateChange={setHomeDay} onOpen={openHomeDay}/><div className="home-highlights">
 <section className="home-highlight-card">
  <div className="home-highlight-heading"><h2>Last activity</h2><button type="button" className="text-button" onClick={()=>{setTab('Trips');setMetricView(null);setDayFilter('all');}}>See all <ChevronRight size={15}/></button></div>
  {visibleJourneys.length?(()=>{const latest=[...visibleJourneys].sort((a,b)=>b.startedAt-a.startedAt)[0];return <button type="button" className="home-last-activity" onClick={()=>{setSelected(latest);setTab('Trips');}}><span className="overview-icon"><ActivityIcon activity={activityLabel(latest.activity)} size={21}/></span><span className="home-last-activity-info"><strong>{latest.title}</strong><small>{new Date(latest.startedAt*1000).toLocaleDateString('en-AU',{day:'numeric',month:'short'})} · {new Date(latest.startedAt*1000).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'})}{latest.endedAt?' – '+new Date(latest.endedAt*1000).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'}):''}</small><small>{activityLabel(latest.activity)} · {tripDistanceText(latest,unit)}</small></span><ChevronRight size={18}/></button>;})():<p className="muted small-copy">Your next recorded activity will appear here.</p>}
 </section>
 <section className="home-highlight-card">
  <div className="home-highlight-heading"><h2>Friends</h2><button type="button" className="text-button" onClick={()=>{setSocialSection('friends');setTab('Social');}}>See friends <ChevronRight size={15}/></button></div>
  {homeFriends.length?<PeopleGrid people={homeFriends} photos={peopleAvatars.photos} selfId={session.user.id} selfAvatar={auth.preferences.avatar} label="Friends and household"/>:<button type="button" className="home-friends-preview" onClick={()=>setTab('Social')}><span className={`home-friends-avatar ${presenceHidden?'home-presence-hidden':''}`}>{presenceHidden?<EyeOff size={21}/>:<Users size={21}/>}</span><span><strong>No recent shared statuses</strong><small>Friends who opt in appear here when their location is recent.</small><small>{friendsLocation.enabled?'You are sharing with friends':'Your friend location is not shared'}</small></span><ChevronRight size={18}/></button>}
 </section>
 </div>{!grouping.records.length&&!cloudJournal.loading&&!cloudJournal.error&&!scopeState.loading&&!scopeState.error&&<div className="home-welcome"><h2>Your next chapter starts here.</h2><p className="muted">No device recordings yet.</p><p>Enable automatic tracking or start an activity. Your history will appear in Trips, and your routes in Map.</p></div>}</>}
 {tab==='Record'&&<RecorderPanel state={recording.state} run={recording.run} busy={recording.busy} error={recording.error} vehicles={vehicles} onFinished={trip=>{setSelected(trip);setTab('Trips');}}/>}
 {tab==='Trips'&&!selected&&<div className="social-sections activities-switch" role="group" aria-label="Activities or segments">{[['activities','Activities'],['segments','Segments']].map(([id,label])=><button key={id} type="button" aria-pressed={activitiesView===id} onClick={()=>setActivitiesView(id)}>{label}</button>)}</div>}
 {tab==='Trips'&&activitiesView==='segments'&&!selected&&<SegmentsView owner={session.user.id} journeys={realJourneys} receipts={auth.preferences.syncReceipts} position={mapLocation.position} onLocate={()=>void mapLocation.locate()} unit={unit} onOpen={openSegmentDetail} onOpenActivity={id=>{const trip=realJourneys.find(entry=>entry.id===id);if(trip)setSelected(trip);}} version={segmentsVersion}/>}
 {tab==='Trips'&&activitiesView==='activities'&&<>{localContext.incomplete&&<p className="notice" role="alert">This local journey has more related recordings than can be shown together. Open an original recording to review it.</p>}{grouping.sourceContextIncomplete&&<p className="notice" role="status">Overlapping phone and car recordings need saved route details to verify source matching. Open a recording to load its matching context.</p>}{cloudJournal.paged&&<button className="text-button" onClick={cloudJournal.refresh}>Back to newest activities</button>}{cloudJournal.loading&&<p role="status">Loading saved activity summaries…</p>}{(cloudJournal.error||scopeState.error)&&<p className="notice" role="alert">{cloudJournal.error||scopeState.error}</p>}{cloudJournal.more&&<button className="text-button" disabled={cloudJournal.loading} onClick={cloudJournal.loadMore}>Load more saved activities</button>}{fleet.error&&vehicles.some(v=>v.source==='tesla')&&<p role="status" className="notice">{fleet.error}</p>}{fleet.more&&<button className="text-button" disabled={fleet.loadingMore} onClick={fleet.loadMore}>{fleet.loadingMore?'Loading…':'Load older Tesla journeys'}</button>}{tripActionsOpen&&<div className="trip-popover" role="group" aria-label="Activity actions"><button type="button" onClick={()=>{setSheet('historical');setTripActionsOpen(false);}}><Plus size={17}/> Add past activity</button><button type="button" onClick={()=>{setSheet('grouping');setTripActionsOpen(false);}}><GitMerge size={17}/> Manage merged journeys</button>{grouping.metadata.history?.length>0&&<button type="button" disabled={grouping.busy} onClick={()=>{grouping.act({type:'undo'});setTripActionsOpen(false);}}>Undo last grouping change</button>}</div>}
{lastArchived&&<div className="trip-archive-toast" role="status"><span>Archived “{lastArchived.title}”</span><button type="button" onClick={()=>restoreTrip(lastArchived.id)}>Undo</button></div>}
{tripSearchOpen&&<div className="trip-expanded-search"><Search size={19}/><input ref={tripSearchRef} type="search" aria-label="Search all activity history" placeholder="Search places, activities, tags, dates…" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button type="button" aria-label="Clear search" onClick={()=>setQuery('')}><X size={18}/></button>}</div>}
<FilterToolbar className="map-filter-toolbar activity-filter-toolbar" label="Activity filter options" orientation="horizontal" toolbar={tripToolbar} onAction={tripFilterAction} onClose={closeTripFilters}/>
{activeEquipmentFilter&&<div className="trip-active-filters"><button type="button" className="trip-filter-chip" aria-label={`Remove equipment filter ${activeEquipmentName}`} onClick={()=>setEquipmentFilter('')}>Using {activeEquipmentName}<X size={14} aria-hidden="true"/></button></div>}
{mergeSource&&<div className="trip-merge-hint">Select a second drive to merge. <button type="button" className="text-button" onClick={()=>{setMergeSource(null);setMergeTarget(null);}}>Cancel</button></div>}
{!searchingAllDates&&<div className="trip-date-navigator" role="group" aria-label="Browse journey dates"><button type="button" aria-label="Previous day" onClick={()=>{setDateChosen(true);setDayFilter(shiftDate(dayFilter,-1,today));}}><ChevronRight className="trip-prev-icon" size={18}/></button><div className="trip-date-current"><input ref={tripDateInput} type="date" aria-hidden="true" tabIndex={-1} value={chosenDay(dayFilter,today)||''} max={today} onChange={e=>{if(e.target.value)setDayFilter(e.target.value>=today?'today':e.target.value);}}/><button type="button" aria-label={`Choose journey date, ${dateLabel(dayFilter,today)}`} onClick={()=>openDatePicker(tripDateInput.current)}><span>{dateLabel(dayFilter,today)}</span></button></div><button type="button" aria-label="Next day" disabled={!canShiftForward(dayFilter,today)} onClick={()=>setDayFilter(shiftDate(dayFilter,1,today))}><ChevronRight size={18}/></button>{dayFilter!=='all'&&<button type="button" className="trip-date-today" aria-label={dayFilter==='today'?'Show all dates':'Return to Today'} onClick={()=>setDayFilter(dayFilter==='today'?'all':'today')}>{dayFilter==='today'?'All':'Today'}</button>}</div>}
<div className="section-heading trip-results-heading"><div><h2>{filtered.length} {filtered.length===1?'activity':'activities'}</h2><p className="muted small-copy">{showArchived?'Archived · ':''}{searchingAllDates?'Searching all dates · ':dayFilter!=='all'?`${dateLabel(dayFilter,today)} · `:''}{sort==='duration'?`${Math.floor(filtered.reduce((sum,t)=>sum+t.durationSeconds,0)/60)} min recorded · Longest first`:sort==='distance'?`${filtered.some(t=>t.distanceEstimate)?'~':''}${distanceText(filtered.reduce((sum,t)=>sum+t.distanceMeters,0)/1000,unit)} total · Longest first`:'Newest first'}</p></div><button type="button" className={`trip-shared-toggle${includeSharedActivities?' is-active':''}`} aria-label={includeSharedActivities?'Exclude shared activities':'Include shared activities'} aria-pressed={includeSharedActivities} title={includeSharedActivities?'Shared activities included · tap to exclude':'Include shared activities'} onClick={()=>setIncludeSharedActivities(value=>!value)}><Share2 size={19} aria-hidden="true"/></button></div>
{includeSharedActivities&&sharedFeed.error&&<p role="alert" className="notice">{sharedFeed.error}</p>}{includeSharedActivities&&sharedFeed.loading&&<p role="status" className="muted small-copy">Loading shared activities…</p>}
{filtered.length?<TripsList key={`${filter}|${dayFilter}|${favouritesOnly}|${activeEquipmentFilter}|${sort}|${showArchived}|${includeSharedActivities}`} journeys={filtered} sharing={mySharing} photos={peopleAvatars.photos} unit={unit} sort={sort} query={query} favourites={saved} vehicles={vehicles} busy={grouping.busy||recording.busy||scopeState.loading||Boolean(scopeState.error)} showArchived={showArchived} mergeSource={mergeSource} mergeTarget={mergeTarget} onOpen={trip=>{if(trip.isShared){setOpenSocialJourney(trip.sharedActivityID);}else setSelected(trip);}} onBookmark={bookmarkRow} onEquipment={openEquipment} onArchive={archiveRow} onDelete={trip=>{setDeleteError('');setDeleteTrip(trip);}} onRestore={restoreRow} onMergeSelect={setMergeSource} onMergeTarget={setMergeTarget}/>:cloudJournal.loading||scopeState.loading?<p role="status">Loading saved history…</p>:cloudJournal.error||scopeState.error?<p role="alert" className="notice">Saved history is unavailable. Reconnect or retry; cached recordings have been preserved.</p>:<div className="empty"><Search/><h2>{dayFilter==='today'?'No activities today':'No journeys found'}</h2><p>{dayFilter==='today'?'Activities you record today appear here.':'Try a different place, date or activity.'}</p><button className="secondary" onClick={resetTripFilters}>{dayFilter==='today'?'Show all activities':'Clear filters'}</button></div>}</>}

 {mergeSource&&mergeTarget&&<div className="modal-backdrop" role="presentation"><div className="notice" role="dialog" aria-modal="true" aria-label="Merge journeys" style={{maxWidth:440,margin:'auto',padding:24}}><h2>Merge these activities?</h2><p>Combine the two selected journeys into one timeline while retaining the original GPS recordings and stops. You can undo this later.</p><p className="muted small-copy">Only consecutive activities from the same account can be merged; overlapping recordings and incompatible vehicles are excluded.</p>{grouping.error&&<p role="alert" className="error">{grouping.error}</p>}<div className="detail-actions"><button className="secondary" onClick={()=>{setMergeTarget(null);setMergeSource(null);}}>Cancel</button><button className="primary" disabled={grouping.busy} onClick={confirmMerge}>{grouping.busy?'Merging…':'Yes, merge'}</button></div></div></div>}
 {tab==='Social'&&<div className="social-layout social-redesign"><div className="social-sections" role="group" aria-label="Social sections"><button type="button" aria-pressed={socialSection==='friends'} onClick={()=>setSocialSection('friends')}>Friends</button><button type="button" aria-pressed={socialSection==='household'} onClick={()=>setSocialSection('household')}>Household</button></div>{socialSection==='friends'?<><HouseholdRequests onJoined={refreshHousehold}/><Friends personPhotos={peopleAvatars.photos} selfId={session.user.id} selfAvatar={auth.preferences.avatar} self={{...friendSelf,home:friendSelf.state==='live'&&selfAtHome,activity:presence.self?.activity_label||null}} onHouseholdJoined={refreshHousehold} household={householdMembers} householdLocations={householdLocationProps.memberLocations} sharing={{enabled:friendsLocation.enabled,ready:friendsLocation.ready!==false,error:friendsLocation.error,onChange:friendsLocation.setSharing}} permission={recording.state.permission} precise={recording.state.precise} locations={friendLocations} onShowPerson={showOnMap} onSetHome={()=>setSheet('places')} hasHome={Boolean(homePlace)} invitationCode={pendingInvitation?.kind==='friend'?pendingInvitation.code:null} onInviteConsumed={consumeInvitation} onShareLive={()=>friendsLocation.setSharing(true)}/></>:<><Household invitationCode={pendingInvitation?.kind==='household'?pendingInvitation.code:null} onInviteConsumed={consumeInvitation} personPhotos={peopleAvatars.photos} selfId={session.user.id} selfAvatar={auth.preferences.avatar} onMembershipChanged={refreshHousehold} onShareLive={()=>presence.setLiveSharing(true)} onStopLive={()=>presence.setLiveSharing(false)} liveEnabled={presence.liveEnabled} liveReady={presence.liveReady} liveError={presence.liveError} onRetrySharing={presence.refreshLive} permission={recording.state.permission} precise={recording.state.precise} {...householdLocationProps} onShowMember={showOnMap} onOpenMap={openPeopleMap} vehicles={vehicles} onSaveVehicles={setVehicles} onSetHome={()=>setSheet('places')} hasHome={Boolean(homePlace)}/><HouseholdTrips activities={grouping.records}/></>}</div>}

 {tab==='Map'&&!openSocialJourney&&<><p className="notice" role="status">Map shows loaded activities. Open an activity to load its complete saved route.</p>{cloudJournal.more&&<button className="text-button" disabled={cloudJournal.loading} onClick={cloudJournal.loadMore}>Load more saved activities</button>}{(scopeState.error||cloudJournal.error)&&<p role="alert" className="notice">{scopeState.error||cloudJournal.error}</p>}<div className={`map-explorer map-social-explorer map-page map-page-people`}>
 <h1 className="sr-only">Map</h1>
 {<div className="map-social-layer"><button type="button" className="secondary" aria-pressed={socialMapEnabled} onClick={()=>setSocialMapEnabled(enabled=>!enabled)}>{socialMapEnabled?'Hide shared journeys':'Show friends’ journeys'}</button>{socialMapEnabled&&socialMap.loading&&<span role="status"> Loading shared routes…</span>}{socialMapEnabled&&socialMap.error&&<p role="alert" className="error">{socialMap.error}</p>}{socialMapEnabled&&socialMap.feed.map(j=><button key={j.activity_id} type="button" className="text-button" onClick={()=>setOpenSocialJourney(j.activity_id)}>{j.title}</button>)}</div>}
 <>
 <JourneyMap segmentLayer={mapView.segments?mapSegments.segments:null} onRegion={setMapArea} onSegment={mapView.segments?openSegmentDetail:null} journeys={combinedMapJourneys} overview={socialMapEnabled?null:overview} controls={mapControls(mapView,mapPanel,mapActivities,today,archivedTrips.length)} onControl={mapAction} onJourney={journey=>{if(journey.sharedActivityID)setOpenSocialJourney(journey.sharedActivityID);else{setSelected(journey);setTab('Trips');}}} viewportKey={0} camera={cameraIntent(camera,session.user.id,Boolean(overview))} onCamera={onMapCamera} onPhoto={(journey,photoID)=>{if(journey.sharedActivityID)setOpenSocialJourney(journey.sharedActivityID);else openPhoto(journey,photoID);}} peoplePins={mapPeople} homePresence={(()=>{if(!peopleOnMap||!homePlace)return null;const placed=new Set(mapPeople.flatMap(pin=>pin.members.map(member=>member.name)));const names=presence.people.filter(p=>p.activity_label==='At home'&&!householdMembers.some(m=>m.user_id===p.user_id&&m.position)&&!placed.has(p.display_name)).map(p=>p.display_name);return names.length?{latitude:homePlace.latitude,longitude:homePlace.longitude,count:names.length,names}:null;})()} large  locating={mapLocation.loading} onLocate={async()=>{const position=await mapLocation.locate();if(position){dispatchCamera({type:'focus',personId:'self'});}return position;}}/>{mapLocation.error&&<p role="status" className="notice">{mapLocation.error}</p>}{recorderAvailable()&&!['always','whenInUse'].includes(recording.state.permission)&&<p role="status" className="notice">Allow location access in iOS Settings to show yourself on the map. No earlier position is shown as current.</p>}{overview&&overview.included<overview.total&&<p className="muted small-copy">Route density from your {overview.included} most recent of {overview.total} journeys.</p>}{mapView.routes&&!combinedMapJourneys.length&&<p className="muted small-copy" role="status">No routes match these layers.</p>}{overviewState.pending&&<p className="muted small-copy" role="status">Drawing routes…</p>}{overviewState.error&&<div className="notice" role="alert"><span>Routes could not be prepared. </span><button type="button" className="text-button" onClick={overviewState.retry}>Retry</button></div>}{mapView.segments&&mapSegments.status==='zoom'&&<p className="muted small-copy" role="status">Zoom in to see segments.</p>}{mapView.segments&&mapSegments.status==='idle'&&<p className="muted small-copy" role="status">Move the map to show segments here.</p>}{mapView.segments&&mapSegments.status==='error'&&<p className="notice" role="status">Segments could not be loaded for this area.</p>}</></div></>}

 {tab!=='Map'&&<footer className="page-footer"><span>Go somewhere. Keep the feeling.</span><span><Lock size={12}/> Your routes stay private</span></footer>}</div>}
 </main><MobileNav tab={tab} recordState={recordControlState(recording.state,recording.busy)} onSelect={name=>{setTab(name);setSelected(null);setOpenSocialJourney(null);}}/>
 {deleteTrip&&<div className="modal-backdrop"><DismissibleSheet label="Delete activity" onClose={()=>{if(!recording.busy)setDeleteTrip(null);}}><div className="trip-delete-confirm">{(deleteError||recording.error)&&<p role="alert">{recording.error||deleteError}</p>}<strong>Delete {deleteTrip.title}?</strong>{deletionIDs(deleteTrip).length>1&&<p>This deletes all {deletionIDs(deleteTrip).length} original activities in this journey.</p>}<p>This permanently removes the local activity and its saved route. Original photos in your library remain.</p><div className="detail-actions"><button type="button" className="secondary" disabled={recording.busy} onClick={()=>setDeleteTrip(null)}>Cancel</button><button type="button" className="primary" disabled={recording.busy} onClick={()=>void confirmTripDelete()}>Delete activity</button></div></div></DismissibleSheet></div>}
 {sheet&&<div className="modal-backdrop" onClick={()=>setSheet(null)}><DismissibleSheet key={sheet} onClose={()=>setSheet(null)} label={sheet==='recordingHealth'?'Recording health':sheet==='auth'?'Account access':sheet==='edit'?'Edit journey':sheet==='tracking'?'Tracking & Permissions':sheet==='diagnostics'?'Diagnostics':sheet==='feedback'?'Feedback & Support':sheet==='garage'?'My Collection':sheet==='equipment'?'Activity equipment':sheet==='places'?'Saved places':sheet==='nativeEdit'?'Edit activity':sheet==='historical'?'Add past activity':sheet==='segment'?'Segment':'Your profile'}><button className="close icon-button" aria-label="Close dialog" onClick={()=>setSheet(null)}><X/></button>
 {sheet==='grouping'&&<JourneyGroupingPanel onReview={id=>{const trip=realJourneys.find(t=>t.id===id);if(trip){setSelected(trip);setSheet(null);}}} activities={realJourneys} grouping={grouping} onClose={()=>setSheet(null)}/>}
 {sheet==='profile'&&<><span className="sheet-icon"><ShieldCheck size={28}/></span><p className="eyebrow">YOUR LITTLE CORNER</p><h2>{auth.preferences.displayName||'Your private world.'}</h2><p className="muted">{session?.user.email||'Create an account to get ready for your own story.'}</p><NotificationList items={inbox.items.filter(item=>item.kind!=='poke')} onRead={inbox.markOneRead} onOpen={openNotification}/><div className="status-row"><Lock size={18}/><div><strong>Sharing & privacy</strong><p>Your routes are private. {presenceHidden?'Your live location is not shared.':'Location sharing is enabled.'} Choose who can see your location in Social.</p></div></div><div className="status-row"><Star size={18}/><div><strong>{saved.length} favourite activities</strong><p>Favourites help you find trips again. They do not change sharing permissions.</p></div></div><button type="button" className="secondary full feedback-entry" onClick={()=>setSheet('feedback')}><LifeBuoy size={17}/> Feedback &amp; Support {feedbackUnread>0&&<span className="notification-count">{feedbackUnread} new</span>}<ChevronRight size={16}/></button><div className="profile-tools"><button className="secondary full" onClick={()=>setSheet('diagnostics')}><Gauge size={17}/> Diagnostics</button><button className="secondary full" onClick={()=>setSheet('garage')}><CarIcon size={17}/> My Collection</button></div><div className="profile-tools"><button className="secondary full" onClick={()=>setSheet('places')}><MapPin size={17}/> Saved places</button></div><button className="primary full" onClick={()=>setSheet('account')}>Account & settings <ArrowRight size={18}/></button><button type="button" className="secondary full" onClick={()=>setSheet('tracking')}>Tracking & Permissions</button><button className="secondary full" onClick={()=>setSheet('household')}>Household</button><small className="muted">Your activities remain private. Household setup does not enable location sharing.</small></>}
 {sheet==='recordingHealth'&&<RecordingHealthDetail health={recording.state.recordingHealth} run={recording.run} busy={recording.busy} error={recording.error}/>}
 {sheet==='places'&&<Places places={recording.state.places||NO_PLACES} run={recording.run} busy={recording.busy} error={recording.error}/>}
 {['nativeEdit','historical'].includes(sheet)&&<ActivityEditor trip={selected} vehicles={vehicles} run={recording.run} busy={recording.busy} error={recording.error} historical={sheet==='historical'} onSaved={(result,id)=>{const trip=result.trips.find(t=>t.id===id);if(trip)setSelected(recordedJourney(trip));setSheet(null);}}/>}
 {sheet==='diagnostics'&&<Diagnostics state={recording.state} session={session} preferences={auth.preferences} run={recording.run} refresh={recording.refresh}/>}
 {sheet==='feedback'&&<FeedbackSupport recording={recording}/>}
 {sheet==='segment'&&openSegment&&<SegmentDetail id={openSegment} unit={unit} onChanged={segmentsChanged} onDeleted={()=>{segmentsChanged();setSheet(null);setOpenSegment(null);}}/>}
 {sheet==='garage'&&<Garage vehicles={vehicles} onSave={setVehicles} tripCounts={equipmentTripCounts} onViewTrips={item=>{setEquipmentFilter(String(item.id));setDayFilter('all');setSheet(null);setSelected(null);setTab('Trips');}}/>}
 {sheet==='equipment'&&equipmentTarget&&<EquipmentSheet key={equipmentTarget.id} trip={equipmentTarget} vehicles={vehicles} onAssign={assignEquipment} onAddItem={addCollectionItem} onClose={()=>setSheet(null)} busy={recording.busy}/>}
 {sheet==='account'&&<AccountSettings recording={recording} onTracking={()=>setSheet('tracking')}/>}
 {sheet==='tracking'&&<TrackingPermissions recording={recording} onBack={()=>setSheet('account')}/>}
 {sheet==='household'&&<Household personPhotos={peopleAvatars.photos} selfId={session.user.id} selfAvatar={auth.preferences.avatar} onMembershipChanged={refreshHousehold} onShareLive={()=>presence.setLiveSharing(true)} onStopLive={()=>presence.setLiveSharing(false)} liveEnabled={presence.liveEnabled} liveReady={presence.liveReady} liveError={presence.liveError} onRetrySharing={presence.refreshLive} permission={recording.state.permission} precise={recording.state.precise} {...householdLocationProps} onShowMember={showOnMap} onOpenMap={openPeopleMap} onSetHome={()=>setSheet('places')} hasHome={Boolean(homePlace)}/>}

{error&&<p role="alert" className="error">{error}</p>}</DismissibleSheet></div>}
 {lightbox&&<div className="lightbox" role="dialog" aria-modal="true" aria-label="Journey photographs" onClick={e=>{if(e.target===e.currentTarget)setLightbox(null);}}><button type="button" className="close icon-button" aria-label="Close photographs" onClick={()=>setLightbox(null)}><X/></button><div className="photo-zoom-viewport" onTouchStart={e=>{if(e.touches.length===2)photoPinch.current={distance:Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY),zoom:photoZoom};}} onTouchMove={e=>{if(e.touches.length===2&&photoPinch.current){e.preventDefault();const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);setPhotoZoom(Math.max(1,Math.min(5,photoPinch.current.zoom*d/photoPinch.current.distance)));}}} onTouchEnd={()=>{photoPinch.current=null;}}><PrivateImage className="zoomable-photo" style={{transform:`scale(${photoZoom})`}} onDoubleClick={()=>setPhotoZoom(z=>z>1?1:2)} src={lightbox.trip.photos[lightbox.index].url} alt={lightbox.trip.photos[lightbox.index].caption}/></div><div className="photo-zoom-controls"><button type="button" aria-label="Zoom out" disabled={photoZoom<=1} onClick={()=>setPhotoZoom(z=>Math.max(1,z-.5))}>−</button><span>{Math.round(photoZoom*100)}%</span><button type="button" aria-label="Zoom in" disabled={photoZoom>=5} onClick={()=>setPhotoZoom(z=>Math.min(5,z+.5))}>+</button><button type="button" onClick={()=>setPhotoZoom(1)}>Reset</button></div><p>{lightbox.trip.photos[lightbox.index].caption}</p><div><button className="icon-button" aria-label="Previous photo" disabled={lightbox.index===0} onClick={()=>{setPhotoZoom(1);setLightbox({...lightbox,index:lightbox.index-1});}}><ArrowLeft/></button><span>{lightbox.index+1} / {lightbox.trip.photos.length} · {lightbox.trip.source?'Private photo':'Demo photo'}</span><button className="icon-button" aria-label="Next photo" disabled={lightbox.index===lightbox.trip.photos.length-1} onClick={()=>{setPhotoZoom(1);setLightbox({...lightbox,index:lightbox.index+1});}}><ArrowRight/></button></div></div>}
 </div></>;
}
