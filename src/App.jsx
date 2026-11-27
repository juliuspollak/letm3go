import LoadingMark from './components/LoadingMark.jsx';
import WatchRecordingBanner from './components/WatchRecordingBanner.jsx';
import {localJourneyRefs} from './lib/journeyGrouping.js';
import {useCloudJourneyPage} from './lib/useCloudJourneyPage.js';
import {useJourneyScope} from './lib/useJourneyScope.js';
import {useSyncExternalStore} from 'react';
import {forgetActivityPhotos} from './lib/privateMedia.js';
import {localRecorderJourneys} from './lib/recorder.js';
import {mergeGroupingActivities} from './lib/mergeGroupingActivities.js';
import {requestSync} from './lib/syncNow.js';
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
import {LIVE_SECONDS,memberLocationState,peoplePins,memberActivities,freshnessNow,freshnessVisibility} from './lib/householdLocation.js';
import {cameraIntent,cameraReducer,initialCamera,shouldFocusSelf} from './lib/mapCamera.js';
import {secondsAtPlace} from './lib/peopleMap.js';
import {useFriendLocations} from './lib/useFriendLocations.js';
import {useFleetJourneys} from './lib/useFleetJourneys.js';
import {useJourneyGrouping} from './lib/useJourneyGrouping.js';
import {createJourneySync} from './lib/journeyMetadataStore.js';
import AnimatedWordmark from './components/AnimatedWordmark.jsx';
import ActivityIcon from './components/ActivityIcon.jsx';
import TripsList from './components/TripsList.jsx';
import MobileNav from './components/MobileNav.jsx';
import NavButton from './components/NavButton.jsx';
import {NAV_ITEMS} from './lib/navigation.js';
import {recordControlState} from './lib/recordingState.js';
import AutoCloudSync from './components/AutoCloudSync.jsx';
import WatchSegmentSync from './components/WatchSegmentSync.jsx';
import {distanceText} from './lib/distanceUnits.js';
import { setNativeAppearance } from './lib/appleMaps.js';
import {App as NativeApp} from '@capacitor/app';
import TrackingPermissions from './components/TrackingPermissions.jsx';
import {RecordingHealthChip,RecordingHealthDetail,RecordingWarning} from './components/RecordingHealth.jsx';
import {useRecordingWarning} from './lib/useRecordingWarning.js';
import LoadingScreen,{TopProgress} from './components/LoadingScreen.jsx';
import DismissibleSheet from './components/DismissibleSheet.jsx';
import PrivateImage from './components/PrivateImage.jsx';
import EquipmentSheet from './components/EquipmentSheet.jsx';
import {EquipmentChip} from './components/EquipmentChip.jsx';
import {equipmentTripCount,equipmentUsage,itemTitle,tripEquipmentLabel,tripUsesEquipment} from './lib/collection.js';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Check, CircleDot, Users, Gauge, Car as CarIcon, ArrowUpRight, ArrowLeft, ArrowRight, Star, ChevronRight, Home, MapPin, Plus, Search, ShieldCheck, SlidersHorizontal, Sun, Moon, User, X, Route, Lock, GitMerge, EyeOff, Eye, LifeBuoy, Share2, Layers, Sparkles, Hand } from 'lucide-react';
import {activitySource as normalizeActivitySource,activitySourceCounts,matchesActivitySource} from './lib/activitySource.js';
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
import PeopleGrid,{PeopleSkeleton} from './components/PeopleGrid.jsx';
import HomeDailySummary from './components/HomeDailySummary.jsx';
import HomeLocationRefresh from './components/HomeLocationRefresh.jsx';
import {requestSharedLocations,refreshLabel} from './lib/locationRefresh.js';
import {homeJourneysForDay} from './lib/homeDailyStats.js';
import {homePeople,friendsStillLoading} from './lib/homePeople.js';
import ActivityEditor from './components/ActivityEditor.jsx';
import SharedActivityDetail from './components/SharedActivityDetail.jsx';
import PersonMap from './components/PersonMap.jsx';
import MapPersonBar from './components/MapPersonBar.jsx';
import {useDriveTimes} from './lib/useDriveTimes.js';
import {usePeoplePlaceLabels} from './lib/usePeoplePlaceLabels.js';
import {useActivityWeather} from './lib/useActivityWeather.js';
import { saveSyncReceipts } from './lib/syncReceipts.js';
import {clearPersonDays} from './lib/personDayCache.js';
import {forgetLiveRoads} from './lib/liveRoads.js';
import {forgetAutoShareFailures} from './lib/householdAutoShare.js';
import {useLiveRoads} from './lib/useLiveRoads.js';
import {useHouseholdAutoShare} from './lib/useHouseholdAutoShare.js';
import { AuthProvider, useAuth } from './lib/AuthContext.jsx';
import AuthScreen from './components/AuthScreen.jsx';
import Onboarding from './components/Onboarding.jsx';
import AccountSettings from './components/AccountSettings.jsx';
import Household from './components/Household.jsx';
import { useRecorder } from './lib/useRecorder.js';
import { recorder, recorderAvailable, recordedJourney, visibleRecorderJourneys } from './lib/recorder.js';
import HouseholdPlaces from './components/HouseholdPlaces.jsx';
import {useHouseholdPlaces} from './lib/useHouseholdPlaces.js';
import {useSocialRestPlaces} from './lib/useSocialRestPlaces.js';
import { supabase } from './lib/supabase.js';
import { perfRender, perfScreen, perfSpan, perfTap } from './lib/perfMonitor.js';
const HOME_PEOPLE=6;
// One empty list, so a missing places value does not look like a change on every render.
const NO_PLACES=[];
const activities=['All activities','Unknown','Cycling','MTB','Hiking','Walking','Running','Road cycling','Kitesurfing','Driving','Gym','Strength training','Pilates','Rope skipping','Other'];
export default function App(){
 useEffect(()=>{const theme=localStorage.getItem('letm3go-theme')==='dark'?'dark':'light';document.documentElement.dataset.theme=theme;void setNativeAppearance(theme).catch(()=>{});},[]);
 const token=new URLSearchParams(window.location.search).get('journey');
 return token?<SharedActivityDetail token={token} onBack={()=>{window.location.href=window.location.pathname;}}/>:<AuthProvider><AuthGate/></AuthProvider>;
}
function AuthGate(){
 const auth=useAuth();
 if(['restoring','deleting'].includes(auth.status))return <LoadingScreen message={auth.status==='deleting'?'Deleting your account securely…':'Restoring your private world…'}/>;
 if(!['authenticated','offline'].includes(auth.status)||auth.recovery)return <AuthScreen/>;
 if(!auth.preferences.onboardingComplete)return <>{(auth.error||auth.integrationWarning)&&<p className="notice" role="alert">{auth.error||auth.integrationWarning}</p>}<Onboarding/></>;
 return <>{(auth.error||auth.integrationWarning)&&<p className="notice" role="alert">{auth.error||auth.integrationWarning}</p>}<PrivateApp key={auth.session.user.id}/></>;
}
function PrivateApp(){
 // Timing only: how long this render took, for the performance report (lib/perfMonitor.js).
 // eslint-disable-next-line react-hooks/purity
 const renderStarted=performance.now();
 useEffect(()=>{perfRender(performance.now()-renderStarted);});
 const auth=useAuth();
 const session=auth.session;
 const [familySetup]=useState(()=>{try{return sessionStorage.getItem('letm3go:family-setup')===session.user.id;}catch{return false;}});
 useEffect(()=>{try{sessionStorage.removeItem('letm3go:family-setup');}catch{/* Optional navigation hint. */}},[]);
 const peopleAvatars=usePeopleAvatars(session.user.id,auth.status==='authenticated',auth.preferences.avatar);
 const unit=auth.preferences.distanceUnit||'km';
 const saved=useMemo(()=>auth.preferences.bookmarks||[],[auth.preferences.bookmarks]);
 const recording=useRecorder(session.user.id,auth.rebindRecorder);
 const [clock,setClock]=useState(()=>({wall:Date.now(),freshness:freshnessNow()}));
 const {wall:motionClock,freshness:freshnessClock}=clock;
 useEffect(()=>{
  const updateClock=()=>setClock({wall:Date.now(),freshness:freshnessNow()});
  const onVisibility=()=>{freshnessVisibility(document.visibilityState==='hidden');updateClock();};
  const interval=setInterval(updateClock,15000);
  document.addEventListener('visibilitychange',onVisibility);
  let mounted=true,listener;
  if(recorderAvailable())void NativeApp.addListener('appStateChange',({isActive})=>{
   freshnessVisibility(!isActive);updateClock();
  }).then(handle=>{if(mounted)listener=handle;else void handle.remove();}).catch(()=>{});
  return()=>{mounted=false;clearInterval(interval);document.removeEventListener('visibilitychange',onVisibility);void listener?.remove();};
 },[]);
 const automaticPresenceActivity=householdActivity(recording.state,motionClock/1000);
 const presence=useHouseholdPresence(session.user.id,auth.status==='authenticated',automaticPresenceActivity,recording.state.nativeFamilySharing?.lastUploadOkAt||0);
 const friendsLocation=useFriendLocations(session.user.id,auth.status==='authenticated');
 const presenceHidden=!(presence.liveEnabled||friendsLocation.enabled);
 const refreshAvatars=peopleAvatars.refresh,refreshLiveLocations=presence.refreshLive;
 const {ready:householdPlacesReady,places:householdPlaces,error:householdPlacesError,refresh:refreshHouseholdPlaces}=useHouseholdPlaces(session.user.id,auth.status==='authenticated');
 useSocialRestPlaces(session.user.id,householdPlaces,householdPlacesReady&&recording.state.storageReady);
 const refreshHousehold=useCallback(()=>{refreshAvatars();void refreshLiveLocations();void refreshHouseholdPlaces();},[refreshAvatars,refreshLiveLocations,refreshHouseholdPlaces]);
 const [photoZoom,setPhotoZoom]=useState(1);
 const photoPinch=useRef(null);
 const fleet=useFleetJourneys(session.user.id,true);
 // `useRecorder` returns a stable snapshot between real changes, so memoising the
 // grouping input and trip projections on their raw fields prevents
 // `reconcileSources` + `buildJourneys` from re-running over every journey on each
 // two-second recorder poll — the dominant cause of jank while scrolling lists.
 const vehicles=useMemo(()=>auth.preferences.vehicles||[],[auth.preferences.vehicles]);
 // The journey build reads only a vehicle's id, name and Tesla link (they match phone and car recordings); its photo, receipts and other
 // sync fields change all the time and must not count as a change.
 const groupingVehiclesKey=useMemo(()=>JSON.stringify(vehicles.map(({id,name,teslaVehicleID})=>({id,name,teslaVehicleID}))),[vehicles]);
 const groupingVehicles=useMemo(()=>JSON.parse(groupingVehiclesKey),[groupingVehiclesKey]);
 const localTimeZone=Intl.DateTimeFormat().resolvedOptions().timeZone;
 const localProjectionCache=useMemo(()=>({owner:session.user.id,timeZone:localTimeZone,values:new WeakMap()}),[session.user.id,localTimeZone]);
 const realJourneys=useMemo(()=>{const end=perfSpan('localRecorderJourneys');const out=localRecorderJourneys({ownerID:recording.state.ownerID,trips:recording.state.trips},session.user.id,localProjectionCache.values);end({trips:recording.state.trips?.length});return out;},[recording.state.trips,recording.state.ownerID,session.user.id,localProjectionCache]);
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
 const [mergeMode,setMergeMode]=useState(false),[mergeIDs,setMergeIDs]=useState([]),[mergeConfirm,setMergeConfirm]=useState(false);
 const [mergeError,setMergeError]=useState('');
 const stopMerging=()=>{setMergeMode(false);setMergeIDs([]);setMergeConfirm(false);setMergeError('');};
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
  if(result){clearDeletedPreferences([...ids,deleteTrip.id]);setDeleteTrip(null);setSelected(null);requestSync();}else setDeleteError('Could not delete every selected activity. Retry safely or cancel.');
 }
 const [metricView,setMetricView]=useState(null);
 const [socialSection,setSocialSection]=useState('friends');
 const [includeSharedActivities,setIncludeSharedActivities]=useState(false);
 const activitySourceChoice=normalizeActivitySource(auth.preferences.activitySource);
 const chooseActivitySource=value=>{if(value===activitySourceChoice)return;void auth.savePreferences({activitySource:value}).catch(err=>setError(err.message||'Your Auto / Manual choice could not be saved.'));};
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
  if(id==='social')setSocialMapEnabled(enabled=>!enabled);
  else if(id.startsWith('panel:'))setMapPanel(previous=>panelChange(previous,id));
  else setMapView(previous=>toolbarChange(previous,id));
 },[]);

 // Show everyone, follow a person or explore freely (see lib/mapCamera.js).
 const [camera,dispatchCamera]=useReducer(cameraReducer,initialCamera);
 const [tripSearchOpen,setTripSearchOpen]=useState(false);
 const [tripFiltersOpen,setTripFiltersOpen]=useState(false);
 const [tripFilterCategory,setTripFilterCategory]=useState(null);
 const closeTripFilters=useCallback(()=>setTripFiltersOpen(false),[]);
 const [equipmentFilter,setEquipmentFilter]=useState('');
 const [equipmentTarget,setEquipmentTarget]=useState(null);
 const tripSearchRef=useRef(null);
 const tripDateInput=useRef(null);

 const recordingWarning=useRecordingWarning();
 const [homeDay,setHomeDay]=useState('today');
 const [themePulse,setThemePulse]=useState(0);
 const openLocations=()=>{setSheet('householdPlaces');void refreshHouseholdPlaces();void refreshLiveLocations();void friendsLocation.refresh();};
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
  else if(target.screen==='household'){setSheet(null);setTab('Social');setSocialSection('household');}
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
 const journalDate=tab==='Trips'?(tripSearchOpen&&query.trim()?'all':dayFilter):tab==='Map'?(mapView.routes==='today'?'today':mapView.day||(/d$/.test(mapView.range)?mapView.range:'all')):homeDay;
 const cloudJournal=useCloudJourneyPage({owner:session.user.id,sync:journeySync,date:journalDate,query:tab==='Trips'?query:'',activity:tab==='Trips'?filter:tab==='Map'?mapView.activity||'All activities':'All activities',sort:tab==='Trips'?sortPreference:'newest',equipment:tab==='Trips'?equipmentFilter:null,favourites:tab==='Trips'&&favouritesOnly?saved:null,archived:archivedTrips,showArchived:tab==='Trips'&&showArchived});
 const localIDs=useMemo(()=>localGroupingActivities.filter(trip=>matchesDate(trip,journalDate,new Date().toLocaleDateString('en-CA'))).sort((a,b)=>b.startedAt-a.startedAt).slice(0,50).map(trip=>trip.id),[localGroupingActivities,journalDate]);
 const detailIDs=useMemo(()=>{
  const ids=selected?.sourceRecords?.map(s=>s.id)|| (selected?[selected.id]:[]);
  return [...new Set(ids.flatMap(id=>id.startsWith('linked:')?[id,id.slice(7)]:[id]))];
 },[selected]);
 const contextIDs=[...new Set([...detailIDs,...(mapView.routes==='pinned'?saved.slice(0,100).map(id=>id.replace(/^journey:/,'')):[]),...cloudJournal.ids,...localIDs])].slice(0,200);
 const contextInput=JSON.stringify(contextIDs);
 const contextEdges=JSON.stringify([journeySync.read().metadata?.links||[],journeySync.read().metadata?.sourceLinks||[]]);
 const localContext=useMemo(()=>{const [links,sourceLinks]=JSON.parse(contextEdges);return localJourneyRefs(localGroupingActivities,JSON.parse(contextInput),{links,sourceLinks});},[localGroupingActivities,contextInput,contextEdges]);
 const rows=journeySync.read().activityRows;
 const visibleScopes=Object.values(journeySync.read().cache?.scopes||{}).filter(scope=>scope.ids.some(id=>contextIDs.includes(id)));
 const knownIDs=[...new Set([...contextIDs,...localContext.ids,...visibleScopes.flatMap(scope=>scope.ids)])];
 const mapDetailIDs=tab==='Map'&&mapView.routes?knownIDs.filter(id=>rows?.[id]&&!realJourneys.some(trip=>trip.id.toLowerCase()===id.toLowerCase())).slice(0,10):[];
 const sourceDetailIDs=selected?knownIDs.filter(id=>{
  const row=rows?.[id];return row&&((row.recording_mode==='tesla')!==(selected.source==='tesla'))&&Date.parse(row.started_at)/1000<=selected.endedAt&&Date.parse(row.ended_at)/1000>=selected.startedAt;
 }):[];
 const requestedDetails=[...new Set([...detailIDs,...sourceDetailIDs,...mapDetailIDs])];
 const scopeState=useJourneyScope({owner:session.user.id,sync:journeySync,refs:contextIDs,details:requestedDetails,localDetailIDs:knownIDs.filter(id=>localGroupingActivities.some(trip=>trip.id===id))});
 const contextKey=JSON.stringify(knownIDs),detailKey=JSON.stringify(requestedDetails);
 const deletedKey=JSON.stringify(recording.state.deletedIDs||[]);
 const groupingActivities=useMemo(()=>{
  return mergeGroupingActivities({localActivities:localGroupingActivities,rows,ids:JSON.parse(contextKey),detailed:new Set(JSON.parse(detailKey)),deleted:new Set((deletedKey?JSON.parse(deletedKey):[]).map(id=>id.toLowerCase()))});
 },[localGroupingActivities,rows,contextKey,detailKey,deletedKey]);
 const cloudPlaces=journeySync.read().savedPlaces;
 // The journey build sees only the place fields it uses (name, kind, position, size). Everything else on a place, and everything the
 // sync pass keeps updating, must not count as a change: each one rebuilt every journey (about 0.6 s on this phone).
 const projectionPlacesKey=useMemo(()=>JSON.stringify([...new Map([...(cloudPlaces||[]),...(recording.state.places||NO_PLACES)].map(place=>[place.id,place])).values()].map(({id,name,kind,latitude,longitude,radius})=>({id,name,kind,latitude,longitude,radius}))),[cloudPlaces,recording.state.places]);
 const projectionPlaces=useMemo(()=>JSON.parse(projectionPlacesKey),[projectionPlacesKey]);
 // Roads are published to the live trail only while someone could be watching it.
 useLiveRoads({trip:recording.state.automaticTrip,owner:session.user.id,enabled:auth.status==='authenticated'&&Boolean(presence.liveEnabled||friendsLocation.enabled)});
 useHouseholdAutoShare({client:supabase,recorder,enabled:auth.status==='authenticated'&&recorderAvailable(),finishedCount:realJourneys.filter(t=>t.endedAt).length,receipts:auth.preferences.syncReceipts,checkpoint:syncReceipts=>saveSyncReceipts(auth.savePreferences,syncReceipts)});
 const grouping=useJourneyGrouping({owner:session.user.id,activities:groupingActivities,processingActivities:realJourneys,telemetry:fleet.charges,places:projectionPlaces,vehicles:groupingVehicles,metadataValue:journeySync.read().metadata,sync:journeySync});
 const sharedFeed=useSharedActivityFeed(tab==='Trips'&&includeSharedActivities,session.user.id);
 // Who can see my shared activities: reloaded when an activity's details close.
 const mySharing=useMySharing(tab==='Trips',session.user.id,selected?.id??'list');
 // The open Map panel closes with the page, like any other transient control.
 const [panelTab,setPanelTab]=useState(tab);
 if(panelTab!==tab){setPanelTab(tab);setMapPanel(null);}
 const mapLocation=useMapLocation(session.user.id,tab==='Map'||tab==='Home'||tab==='Social',recording.state.permission);
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
 const householdMembers=useMemo(()=>presence.liveMembers.map(row=>({...row,...memberLocationState(row,motionClock,freshnessClock),source:'household'})),[presence.liveMembers,motionClock,freshnessClock]);
 // A member who joins (or first appears) after photos loaded gets their photo
 // without waiting for the app to return to the foreground.
 const householdMemberKey=householdMembers.map(m=>m.user_id).sort().join(',');
 useEffect(()=>{if(householdMemberKey)refreshAvatars();},[householdMemberKey,refreshAvatars]);
 const friendMembers=useMemo(()=>friendsLocation.people.filter(p=>!presence.liveMembers.some(m=>m.user_id===p.user_id))
  .map(p=>({...p,sharing_enabled:true,location_at:p.updated_at,source:'friend'}))
  .map(row=>({...row,...memberLocationState(row,motionClock,freshnessClock)})),[friendsLocation.people,presence.liveMembers,motionClock,freshnessClock]);
 // Coarse statuses members already share (Driving, Walking...), for the person model only.
 const sharedActivities=useMemo(()=>memberActivities(presence.people,presence.liveMembers,motionClock,freshnessClock),[presence.people,presence.liveMembers,motionClock,freshnessClock]);
 // Your own time at a place, as your household sees it, and only while your
 // shared position is current, so it never outlives what was actually published.
 const selfArrival=presence.selfArrival;
 const selfArrivalAge=memberLocationState({...selfArrival,sharing_enabled:true},motionClock,freshnessClock).ageSeconds;
 const selfSeconds=presence.liveEnabled&&selfArrivalAge!=null&&selfArrivalAge<=LIVE_SECONDS?secondsAtPlace({...selfArrival,state:'live'}):null;
 const savedPlaces=useMemo(()=>[...householdPlaces,...(recording.state.places||NO_PLACES).map(place=>place.kind==='home'?{...place,kind:'legacyHome',icon:'none',radius:place.homeRecognitionRadius??place.radius}:place)],[recording.state.places,householdPlaces]);
 const peopleMembers=useMemo(()=>[...householdMembers,...friendMembers].filter(member=>member.user_id!==session.user.id),
  [householdMembers,friendMembers,session.user.id]);
 const mapPinOptions=useMemo(()=>({
  self:mapLocation.position?{...mapLocation.position,name:auth.preferences.displayName||'You',seconds:selfSeconds,activity:automaticPresenceActivity}:null,
  photos:peopleAvatars.photos,selfId:session.user.id,selfAvatar:auth.preferences.avatar,places:savedPlaces,activities:sharedActivities,nowMs:motionClock
 }),[mapLocation.position,auth.preferences.displayName,selfSeconds,automaticPresenceActivity,peopleAvatars.photos,
  session.user.id,auth.preferences.avatar,savedPlaces,sharedActivities,motionClock]);
 const allPeoplePins=useMemo(()=>peoplePins({...mapPinOptions,members:peopleMembers}),[mapPinOptions,peopleMembers]);
 const mapPeople=useMemo(()=>mapView.people?allPeoplePins:peoplePins(mapPinOptions),[mapView.people,allPeoplePins,mapPinOptions]);
 // What the household sees of you: confirmed sends, not just the switch.
 const selfSharedAt=Math.max(presence.lastPublishedAt||0,(recording.state.nativeFamilySharing?.lastPublishedCaptureAt||0)*1000);
 const ownSharedLocation=householdMembers.find(member=>member.user_id===session.user.id);
 const selfLocationState=!presence.liveEnabled?{state:'off',ageSeconds:null}:
  ownSharedLocation?.ageSeconds!=null?ownSharedLocation:selfSharedAt?{state:motionClock-selfSharedAt<=LIVE_SECONDS*1000?'live':'stale',ageSeconds:Math.max(0,Math.round((motionClock-selfSharedAt)/1000))}:{state:'waiting',ageSeconds:null};
 const selfLocation={state:selfLocationState.state,ageSeconds:selfLocationState.ageSeconds,homeSeconds:selfSeconds,activity:presence.self?.activity_label||null};
 // Explicit navigation to one member follows that person; the map otherwise shows everyone.
 const showOnMap=useCallback((position,userId)=>{setSheet(null);setSelected(null);setMapView(view=>({...view,content:'routes',people:true}));dispatchCamera(userId?{type:'focus',personId:userId}:{type:'showAll'});setTab('Map');},[]);
 // Tapping a person on Home opens the Map tab on that person; poking is a separate action (the tile's ••• menu and the person bar).
 // Only the person is remembered here: the Map's saved layers and filters are not touched by choosing someone.
 const [mapPersonSel,setMapPersonSel]=useState(null);
 const [sharedOwner,setSharedOwner]=useState(null);
 const [mapViewState,setMapViewState]=useState(null);
 const mapDetailOrigin=useRef(null),mapResumeSequence=useRef(0);
 const [mapResume,setMapResume]=useState(null);
 const rememberMapOrigin=useCallback((options={})=>{
  mapDetailOrigin.current={scrollY:window.scrollY,fullscreen:options.fullscreen===true};
  setMapResume(null);
 },[]);
 const closeActivity=useCallback(()=>{
  const origin=tab==='Map'?mapDetailOrigin.current:null;
  mapDetailOrigin.current=null;
  setSelected(null);setOpenSocialJourney(null);setSharedOwner(null);
  if(origin)setMapResume({...origin,request:++mapResumeSequence.current});
 },[tab]);
 const resumedFullscreen=useCallback(()=>setMapResume(previous=>previous?{...previous,fullscreen:false}:previous),[]);
 useEffect(()=>{
  if(!mapResume||tab!=='Map'||selected||openSocialJourney)return;
  let second=0;
  const first=requestAnimationFrame(()=>{second=requestAnimationFrame(()=>window.scrollTo({top:mapResume.scrollY,behavior:'instant'}));});
  return()=>{cancelAnimationFrame(first);cancelAnimationFrame(second);};
 },[mapResume,tab,selected,openSocialJourney]);
 const openSharedOnMap=useCallback((id,person,options)=>{rememberMapOrigin(options);setSharedOwner({userId:person.userId,name:person.name});setOpenSocialJourney(id);},[rememberMapOrigin]);
 const openPersonOnMap=useCallback(person=>{setSheet(null);setSelected(null);setOpenSocialJourney(null);setSharedOwner(null);setMapPersonSel({userId:person.userId,name:person.name});setMapPanel(open=>open==='filters'?null:open);setTab('Map');},[]);
 // One request per person at a time, and none again until "✓ Poked" has gone: a quick second tap, while one is
 // pending or just after it, sends nothing more. A failure frees the button at once, as a retry.
 const [pokeStates,setPokeStates]=useState({});
 const pokeBusy=useRef(new Set()),pokeTimers=useRef(new Map());
 useEffect(()=>{const timers=pokeTimers.current;return()=>timers.forEach(clearTimeout);},[]);
 const pokePerson=useCallback(async person=>{
  const id=person.userId,name=person.name||'them';
  if(pokeBusy.current.has(id))return;
  pokeBusy.current.add(id);
  clearTimeout(pokeTimers.current.get(id));
  setPokeStates(previous=>({...previous,[id]:{state:'sending'}}));
  let next;
  try{
   // A request that never answers must not leave the button disabled for ever.
   await Promise.race([sendPoke(id),new Promise((_,reject)=>setTimeout(()=>reject(new Error('No answer. Check your connection.')),15000))]);next={state:'sent'};
  }
  catch(error){next={state:'failed',message:error.message||`Could not poke ${name}.`};pokeBusy.current.delete(id);}
  setPokeStates(previous=>({...previous,[id]:next}));
  // "✓ Poked" returns to "👋 Poke" after a moment; a failure stays, as a retry, a little longer.
  pokeTimers.current.set(id,setTimeout(()=>{
   pokeBusy.current.delete(id);pokeTimers.current.delete(id);
   setPokeStates(previous=>{const rest={...previous};delete rest[id];return rest;});
  },next.state==='sent'?2500:6000));
 },[]);
 // Everyone I may see, untruncated: the Home row shows the first few, but whether the map
 // stays open and whether cached days are kept depends on this whole list.
 const everyone=useMemo(()=>homePeople({household:householdMembers,friends:friendMembers,selfID:session.user.id,selfPosition:mapLocation.position,places:savedPlaces,activities:sharedActivities,unit}),[householdMembers,friendMembers,session.user.id,mapLocation.position,savedPlaces,sharedActivities,unit]);
 useActivityWeather({trips:realJourneys,enabled:auth.status==='authenticated'});
 const homeRoutePeople=useMemo(()=>everyone.slice(0,HOME_PEOPLE),[everyone]);
 const visibleRoutePeople=useMemo(()=>{
  const people=tab==='Home'?homeRoutePeople:everyone;
  return tab==='Map'?people:people.filter(person=>!person.location.home&&!person.location.verifiedHome);
 },[tab,homeRoutePeople,everyone]);
 const tilesVisible=tab==='Home'||tab==='Social';
 const tileRoutesEnabled=tilesVisible&&['always','whenInUse'].includes(recording.state.permission)&&!mapLocation.error;
 const driveTimes=useDriveTimes({people:visibleRoutePeople,from:mapLocation.position,enabled:tab==='Map'||tileRoutesEnabled,scope:session.user.id});
 const walkTimes=useDriveTimes({people:visibleRoutePeople,from:mapLocation.position,enabled:tileRoutesEnabled,transport:'walking',scope:session.user.id});
 const cycleTimes=useDriveTimes({people:visibleRoutePeople,from:mapLocation.position,enabled:tileRoutesEnabled,transport:'cycling',scope:session.user.id});
 const nearbyLabels=usePeoplePlaceLabels(tab==='Home'?homeRoutePeople:everyone,{enabled:auth.status==='authenticated'&&tilesVisible&&!selected&&!openSocialJourney,scope:session.user.id});
 const peopleById=useMemo(()=>new Map(everyone.map(person=>[person.userId,{...person,nearbyPlace:nearbyLabels[person.userId],driveSeconds:driveTimes[person.userId],walkSeconds:walkTimes[person.userId],cycleSeconds:cycleTimes[person.userId]}])),[everyone,nearbyLabels,driveTimes,walkTimes,cycleTimes]);
 // Until both lists have answered once, an empty list means "not loaded yet", not "nobody is sharing".
 // A failure, being offline or a slow answer (10 s) ends the wait so it never spins for ever.
 const [friendsWaitOver,setFriendsWaitOver]=useState(false);
 useEffect(()=>{const timer=setTimeout(()=>setFriendsWaitOver(true),10000);return()=>clearTimeout(timer);},[]);
 const friendsLoading=friendsStillLoading({configured:Boolean(supabase),householdReady:presence.liveReady,friendsReady:friendsLocation.ready,householdError:presence.liveError,friendsError:friendsLocation.error,waitOver:friendsWaitOver,online:navigator.onLine});
 const [locationRefresh,setLocationRefresh]=useState(null);
 useEffect(()=>{
  if(!locationRefresh||locationRefresh.pending)return;
  const timer=setTimeout(()=>setLocationRefresh(null),30000);
  return()=>clearTimeout(timer);
 },[locationRefresh]);
 const homeFriends=useMemo(()=>homeRoutePeople.map(person=>({...peopleById.get(person.userId),refreshLabel:refreshLabel(person,locationRefresh),poke:pokeStates[person.userId],receivedPoke:tab==='Home'&&incomingPoke?.actor_id===person.userId,onSelect:()=>openPersonOnMap(person),onPoke:()=>void pokePerson(person),actionLabel:`Show ${person.name||'them'} on the Map.`})),[homeRoutePeople,peopleById,locationRefresh,pokePerson,pokeStates,incomingPoke,tab,openPersonOnMap]);
 // The selected person keeps their live details when they are in the live-location lists. Completed days do not
 // depend on live sharing, so the Map does not drop the person (or lose their cache) because they stopped sharing
 // a location; what a viewer may still see is decided by the server (signals and revalidation in usePersonDay).
 // A selected person's Today marker uses exactly the same avatar/status/speed pin
 // as All people. Isolate this member before grouping: nearby people must not be
 // exposed on their individual day, nor move the marker to a group anchor.
 const selectedPersonPin=useMemo(()=>{
  const id=mapPersonSel?.userId;
  if(!id)return null;
  if(id===session.user.id)return peoplePins({self:mapLocation.position?{...mapLocation.position,name:'You',activity:automaticPresenceActivity}:null,places:savedPlaces,selfId:session.user.id,selfAvatar:auth.preferences.avatar,nowMs:motionClock})[0]||null;
  const member=[...householdMembers,...friendMembers].find(p=>p.user_id===id);
  if(!member)return null;
  return peoplePins({members:[member],photos:peopleAvatars.photos,
   selfId:session.user.id,selfAvatar:auth.preferences.avatar,places:savedPlaces||[],activities:sharedActivities,nowMs:motionClock})[0]||null;
 },[mapPersonSel?.userId,session.user.id,householdMembers,friendMembers,peopleAvatars.photos,auth.preferences.avatar,savedPlaces,sharedActivities,motionClock,mapLocation.position,automaticPresenceActivity]);
 // My own marker, shown on someone else's map only after I press Locate.
 const myLocationPin=useMemo(()=>mapLocation.position?peoplePins({self:{...mapLocation.position,name:'You',activity:automaticPresenceActivity},places:savedPlaces,selfId:session.user.id,selfAvatar:auth.preferences.avatar,nowMs:motionClock})[0]||null:null,[mapLocation.position,automaticPresenceActivity,session.user.id,auth.preferences.avatar,motionClock,savedPlaces]);
 const mapPerson=mapPersonSel&&tab==='Map'?(mapPersonSel.userId===session.user.id?{userId:session.user.id,name:'You',self:true,position:null,status:{text:'Everything you recorded'}}:(everyone.find(p=>p.userId===mapPersonSel.userId)||{userId:mapPersonSel.userId,name:mapPersonSel.name,position:null,status:{text:'Not sharing live location',tone:'stale'}})):null;
 // Explicit tab navigation resets the person scope. Detail navigation keeps
 // the Map tab active so Back restores the existing day and selection.
 if(tab!=='Map'&&(mapPersonSel||mapViewState||mapResume)){
  setMapPersonSel(null);setMapViewState(null);setMapResume(null);
 }
 useEffect(()=>()=>{clearPersonDays(session.user.id);forgetLiveRoads();forgetAutoShareFailures();},[session.user.id]);
 // Show the notification by the profile when the sender is outside the Home grid.
 const pokeShownOnAvatar=tab==='Home'&&!selected&&!openSocialJourney&&Boolean(incomingPoke?.actor_id)&&homeFriends.some(person=>person.userId===incomingPoke.actor_id&&person.receivedPoke);
 const openPeopleMap=useCallback(()=>{setSheet(null);setSelected(null);setMapView(view=>({...view,content:'routes',people:true}));dispatchCamera({type:'showAll'});setTab('Map');},[]);
 // Pressing someone's bubble on the all-people map follows them; it now also shows only that person
 // (the same choice as the person bar), so their day replaces everyone else's pins and routes.
 const everyoneRef=useRef(everyone);useEffect(()=>{everyoneRef.current=everyone;},[everyone]);
 const onMapCamera=useCallback(event=>{
  dispatchCamera({type:'native',mode:event.mode,personId:event.personId,command:event.command});
  if(event.mode!=='person'||!event.personId)return;
  const id=event.personId==='self'?session.user.id:String(event.personId);
  const person=id===session.user.id?{userId:id,name:'You'}:everyoneRef.current.find(p=>p.userId===id);
  if(!person)return;
  setMapPersonSel(previous=>previous?.userId===person.userId?previous:{userId:person.userId,name:person.name});
  setMapPanel(open=>open==='filters'?null:open);
 },[session.user.id]);
 useEffect(()=>{
  const opened=event=>{const invite=event.detail;if(!invite||!['friend','household'].includes(invite.kind))return;setPendingInvitation(invite);setSocialSection(invite.kind==='household'?'household':'friends');setTab('Social');};
  window.addEventListener('letm3go:invitation-opened',opened);
  return()=>window.removeEventListener('letm3go:invitation-opened',opened);
 },[]);
 useEffect(()=>{if(pendingInvitation){queueMicrotask(()=>{setSocialSection(pendingInvitation.kind==='household'?'household':'friends');setTab('Social');});}},[pendingInvitation]);
 const consumeInvitation=()=>{setPendingInvitation(null);try{sessionStorage.removeItem('letm3go:pending-invitation');}catch{/* Storage may be unavailable; in-memory invitation is cleared. */}};

 useEffect(()=>{perfScreen(tab);},[tab]);
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
 const openOwnActivity=useCallback((id,options)=>{const same=t=>String(t.id).toLowerCase()===String(id).toLowerCase();const trip=realJourneys.find(same)||visibleJourneys.find(same);if(!trip)return false;rememberMapOrigin(options);setSelected(trip);return true;},[realJourneys,visibleJourneys,rememberMapOrigin]);
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
 const selectedActivity=selected?(visibleJourneys.find(j=>j.id===selected.id)||realJourneys.find(j=>j.id===selected.id)||selected):null;
 const today=new Date().toLocaleDateString('en-CA');
 const mapJourneys=useMemo(()=>mapViewJourneys(grouping.journeys,mapView,today,saved,archivedTrips),[grouping.journeys,mapView,today,saved,archivedTrips]);
 const combinedMapJourneys=useMemo(()=>socialMapEnabled?[...socialMap.journeys.slice(0,15),...mapJourneys.slice(0,35)]:mapJourneys,[mapJourneys,socialMapEnabled,socialMap.journeys]);
 const mapActivities=useMemo(()=>activityChoices(grouping.journeys),[grouping.journeys]);
 // The route overview: a density map of every shown journey (not only the 50
 // most recent) with clustered photos. Rebuilt only when the journeys change.
 const overviewState=useMapOverview(mapJourneys,{enabled:tab==='Map'&&mapView.content==='routes'&&Boolean(mapView.routes),unit});
 const overview=overviewState.overview;
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
 // The Auto / Manual / All counts follow every other filter (day, type, favourites, equipment, search), so a bubble never
 // promises more activities than the list would show for it. Only the source choice itself is left out.
 const scopedRows=useMemo(()=>activityRows.filter(t=>
  (t.isShared?(!showArchived&&!favouritesOnly&&!activeEquipmentFilter):(showArchived?archivedTrips.includes(t.id):!archivedTrips.includes(t.id))&&(!favouritesOnly||saved.includes(t.id)))&&
  (searchingAllDates||matchesDate(t,dayFilter,today))&&
  (filter==='All activities'||sameActivity(t.activity,filter))&&
  (!activeEquipmentFilter||tripUsesEquipment(t,vehicles,activeEquipmentFilter))&&
  `${t.searchIndex||''} ${activityLabel(t.activity)} ${activityCode(t.activity)} ${t.title} ${t.ownerName||''} ${t.location||''} ${t.date} ${t.collection||''} ${t.notes||''} ${(t.tags||[]).join(' ')} ${t.isShared?'Shared':''} ${t.isShared?'':tripEquipmentLabel(t,vehicles)}`.toLowerCase().includes(query.toLowerCase())
 
 ),
 [activityRows,showArchived,archivedTrips,favouritesOnly,saved,searchingAllDates,query,dayFilter,today,filter,activeEquipmentFilter,vehicles]);
 const sourceCounts=useMemo(()=>activitySourceCounts(scopedRows),[scopedRows]);
 const filtered=useMemo(()=>scopedRows.filter(t=>matchesActivitySource(t,activitySourceChoice)).sort((a,b)=>sort==='duration'?b.durationSeconds-a.durationSeconds||b.startedAt-a.startedAt:sort==='distance'?b.distanceMeters-a.distanceMeters||b.startedAt-a.startedAt:b.startedAt-a.startedAt)
 ,[scopedRows,activitySourceChoice,sort]);
 const selectingMerge=mergeMode&&tab==='Trips'&&activitiesView==='activities';
 // Only activities still on screen count: a filter, day or search change must not leave
 // hidden ones in the selection.
 const pickedMergeIDs=useMemo(()=>mergeIDs.filter(id=>filtered.some(t=>t.id===id)),[mergeIDs,filtered]);
 // Leaving the Activities list ends merge mode (adjusting state during render, as React advises).
 if(mergeMode&&!selectingMerge)stopMerging();
 const confirmMerge=async()=>{
  if(pickedMergeIDs.length<2||recording.busy)return;
  // A phone and a Watch copy of the same ride are one activity: the first local copy is merged, every copy is replaced.
  const localOnly=trip=>(trip.sourceRecords||[trip]).filter(record=>['device','watch','simulator'].includes(record.source));
  const parts=pickedMergeIDs.map(id=>filtered.find(t=>t.id===id)).filter(Boolean).map(localOnly);
  if(parts.length<2||parts.some(records=>!records.length)){setMergeError('Only activities recorded on this iPhone or Apple Watch can be merged.');return;}
  const chosen=pickedMergeIDs.map(id=>filtered.find(t=>t.id===id)).filter(Boolean).sort((a,b)=>a.startedAt-b.startedAt);
  if(new Set(chosen.map(t=>t.activity)).size>1){setMergeError('Only activities of the same type can be merged.');return;}
  if(chosen.some((t,i)=>i>0&&(chosen[i-1].endedAt??Infinity)>t.startedAt)){setMergeError('Activities that overlap in time cannot be merged.');return;}
  const deleteIDs=[...new Set(parts.flat().map(record=>record.id))];
  setMergeError('');
  const result=await recording.run('mergeActivities',{ids:parts.map(records=>records[0].id),deleteIDs});
  if(result){clearDeletedPreferences(deleteIDs);stopMerging();setSelected(null);requestSync();}else setMergeError('Those activities could not be merged. Nothing was changed.');
 };

 // Use the same visible, non-household activities as the Activities list.
 // Match the default Activities list: archived and household journeys are excluded.
 const homeJourneys=useMemo(()=>homeJourneysForDay(visibleJourneys,archivedTrips,homeDay,today),[visibleJourneys,archivedTrips,homeDay,today]);
 const openHomeActivity=trip=>{setSheet(null);setOpenSocialJourney(null);setSelected(trip);};
 const activityBackLabel=tab==='Home'?'Back to Home':tab==='Map'?'Back to map':'Back to activities';
 const openHomeDay=day=>{
  setQuery('');setFilter('All activities');setDateChosen(true);setDayFilter(day);
  setMetricView(null);setFavouritesOnly(false);setEquipmentFilter('');setShowArchived(false);
  setTripSearchOpen(false);setTripFiltersOpen(false);setTripFilterCategory(null);
  setSelected(null);setTab('Trips');
 };
  return <><TopProgress active={recorderAvailable()&&!recording.state.storageReady&&!recording.error}/><AutoCloudSync state={recording.state} journeySync={journeySync}/><WatchSegmentSync state={recording.state}/><PokeOverlay poke={incomingPoke} quiet={pokeShownOnAvatar} onDismiss={dismissPoke}/><div className="app-shell"><aside className="desktop-rail"><a className="brand" href="#" onClick={e=>{e.preventDefault();setSelected(null);setTab('Home');}} aria-label="Letm3go Home"><AnimatedWordmark/></a><p className="rail-caption">MAKE ROOM FOR ADVENTURE</p><nav>{NAV_ITEMS.map(({name})=><NavButton key={name} name={name} active={tab===name&&!selected} onSelect={()=>{setTab(name);setSelected(null);}}/>)}</nav><div className="rail-bottom"><div className="private-note"><ShieldCheck size={22}/><strong>Your story. Your choice.</strong><p>Your journeys are private until you choose to share.</p></div><button className="profile-link" onClick={()=>setSheet('profile')}><span className="avatar"><User size={20}/></span><div><strong>{session?'Your account':'Your adventure starts here'}</strong><small>{session?'Manage profile':'Private local activities'}</small></div><ChevronRight size={16}/></button></div></aside>
  <HomeLocationRefresh enabled={tab==='Home'&&!selected&&!openSocialJourney&&!sheet} onRefresh={async()=>{
   const targets=homeRoutePeople.filter(person=>person.state!=='off');
   const baseline=new Map(targets.map(person=>[person.userId,person]));
   setLocationRefresh({baseline,pending:true});
   let requestFailed=false;
   try{
    if(auth.status!=='authenticated')throw new Error('Location refresh requires a connection.');
    const requested=await requestSharedLocations([...baseline.keys()]);
    // The recipient may spend 20 seconds getting a fix, then publish it.
    if(requested>0)await new Promise(resolve=>setTimeout(resolve,25000));
   }catch{
    requestFailed=true;
   }
   const options={reportFailure:true};
   const [household,,friend]=await Promise.allSettled([presence.refreshLive(options),presence.refresh(options),friendsLocation.refresh(options)]);
   setLocationRefresh({baseline,requestFailed,readFailed:{household:household.status==='rejected',friend:friend.status==='rejected'}});
   if(requestFailed)throw new Error('Could not send location requests.');
  }}><header className="topbar"><span className="mobile-brand"><AnimatedWordmark/></span>{tab==='Home'&&<RecordingHealthChip compact health={recording.state.recordingHealth} onOpen={()=>setSheet('recordingHealth')}/>}<div className="breadcrumb">Your world, a little closer.</div><div className="top-actions"><button type="button" className="icon-button theme-toggle" aria-label="Toggle dark theme" aria-pressed={theme==='dark'} onClick={()=>{setTheme(current=>current==='dark'?'light':'dark');setThemePulse(pulse=>pulse+1);}}><span className="theme-toggle-icons" aria-hidden="true">{themePulse>0&&<span key={themePulse} className="theme-toggle-burst"/>}<Sun className="theme-toggle-sun" size={20}/><Moon className="theme-toggle-moon" size={20}/></span></button><HeaderAvatar count={inbox.count} onOpen={()=>setSheet('profile')}><PersonAvatar name={auth.preferences.displayName||'You'} userId={session.user.id} selfId={session.user.id} selfAvatar={auth.preferences.avatar} photos={peopleAvatars.photos} size="sm"/></HeaderAvatar></div></header>
 {/* Below the header, which carries the safe-area padding: above it these sat under the status bar and Dynamic Island, unreadable, and still pushed the header down. */}
 {tab!=='Record'&&<WatchRecordingBanner elsewhere={recording.state.recordingElsewhere} nowMs={motionClock} onOpen={()=>{setSheet(null);setSelected(null);setOpenSocialJourney(null);setTab('Record');}}/>}{error&&<p role="alert" className="error">{error}</p>}{recording.error&&<p role="alert" className="error">{recording.error}</p>}{auth.status==='offline'&&<p className="notice">Offline · Private recordings stay on this device. Cloud actions require reconnection.</p>}
 <RecordingWarning health={recording.state.recordingHealth} run={recording.run} warning={recordingWarning} tab={tab} recording={recording.state.active?.state==='recording'}/>
 {recording.state.active&&<button type="button" className="active-recording-banner" onClick={()=>{setSelected(null);setSheet(null);setTab("Record");}} aria-label="Return to active recording"><span className="live-dot"/><strong>{activityLabel(recording.state.active.activity)} · {recording.state.active.state==="recording"?"Recording": "Paused"}</strong><span>Continue exploring · tap to view recording</span><ArrowRight size={17}/></button>}
 {selected&&scopeState.loading&&!realJourneys.some(trip=>trip.id===selected.id)?<LoadingMark label="Loading saved journey details"/>:selected&&scopeState.error&&!realJourneys.some(trip=>trip.id===selected.id)?<div className="notice" role="alert"><p>{scopeState.error}</p><button onClick={closeActivity}>{activityBackLabel}</button></div>:openSocialJourney?<SharedActivityDetail viewer={session.user.id} activityID={openSocialJourney} ownerName={sharedOwner?.name||sharedRows.find(row=>row.sharedActivityID===openSocialJourney)?.ownerName||'Friend'} ownerID={sharedOwner?.userId||session.user.id} unit={unit} onBack={closeActivity}/>:selected?<ActivityDetailScreen ownerID={session.user.id} unit={unit} key={`${selected.id}:${selectedActivity?.state||'finished'}`} trip={selectedActivity} segmentActivities={realJourneys} journeys={groupingActivities} vehicles={vehicles} onEquipment={openEquipment} onAddEquipment={addCollectionItem} onStopChange={grouping.act} grouping={grouping} onSource={setSelected} places={recording.state.places||NO_PLACES} onBack={closeActivity} backLabel={activityBackLabel} onEdit={()=>setSheet('nativeEdit')} onPhoto={openPhoto} run={recording.run} lastError={recording.lastError} onUpdated={setSelected} onDeleted={()=>{clearDeletedPreferences([selectedActivity.id]);closeActivity();}} busy={recording.busy} error={recording.error}/>
:<div className="page-enter">
 {tab==='Trips'?<div className="tab-heading trip-journal-heading"><h1>Activities</h1>{activitiesView==='activities'&&<div className="trip-heading-actions"><button type="button" className="trip-round-action" aria-label={tripSearchOpen?'Close activity search':'Search all activities'} aria-expanded={tripSearchOpen} onClick={()=>{if(tripSearchOpen)setQuery('');setTripSearchOpen(v=>!v);}}>{tripSearchOpen?<X size={20}/>:<Search size={20}/>}</button><button type="button" className="trip-round-action" aria-label={activeTripFilters?`Activity filters, ${activeTripFilters} active`:'Activity filters'} aria-expanded={tripFiltersOpen} onClick={()=>{setTripFiltersOpen(v=>!v);}}><SlidersHorizontal size={20}/>{activeTripFilters>0&&<span className="trip-filter-count" aria-hidden="true">{activeTripFilters}</span>}</button><button type="button" className={`trip-round-action${selectingMerge?' is-active':''}`} aria-label={selectingMerge?'Stop merging activities':'Merge activities'} aria-pressed={selectingMerge} onClick={()=>{if(selectingMerge)stopMerging();else{setMergeMode(true);setMergeIDs([]);setTripFiltersOpen(false);setTripSearchOpen(false);}}}><GitMerge size={20}/></button></div>}</div>:tab==='Social'?<div className="tab-heading"><h1>Your people.</h1><p className="muted">{presence.liveEnabled||friendsLocation.enabled?'Live sharing is on. You can turn it off any time.':'Share live only when you choose.'}</p></div>:tab==='Record'?<div className="tab-heading"><h1>Record an activity.</h1><p className="muted">Keep recording with the screen locked where iOS permits.</p></div>:null}
 {tab==='Home'&&<><div className="tab-heading"><h1>Your day. Your way.</h1><p className="muted">A little movement. A little perspective. Your day at a glance.</p></div><HomeDailySummary date={homeDay} today={today} journeys={homeJourneys} unit={unit} onDateChange={setHomeDay} onOpen={openHomeDay} onOpenActivity={openHomeActivity}/>
 <section className="home-friends" aria-labelledby="home-friends-title">
  <div className="home-friends-head"><h2 id="home-friends-title">Friends</h2><span className="home-friends-links"><button type="button" className="text-button" onClick={()=>openPersonOnMap({userId:session.user.id,name:'You'})}>My day</button><button type="button" className="text-button" onClick={()=>{setSocialSection('friends');setTab('Social');}}>See friends <ChevronRight size={15}/></button></span></div>
  {homeFriends.length?<PeopleGrid people={homeFriends} photos={peopleAvatars.photos} selfId={session.user.id} selfAvatar={auth.preferences.avatar} label="Friends and household"/>:friendsLoading?<PeopleSkeleton/>:<button type="button" className="home-friends-preview" onClick={()=>setTab('Social')}><span className={`home-friends-avatar ${presenceHidden?'home-presence-hidden':''}`}>{presenceHidden?<EyeOff size={21}/>:<Users size={21}/>}</span><span><strong>No recent shared statuses</strong><small>Friends who opt in appear here when their location is recent.</small><small>{friendsLocation.enabled?'You are sharing with friends':'Your friend location is not shared'}</small></span><ChevronRight size={18}/></button>}
 </section>
 {!grouping.records.length&&!cloudJournal.loading&&!cloudJournal.error&&!scopeState.loading&&!scopeState.error&&<div className="home-welcome"><h2>Your next chapter starts here.</h2><p className="muted">No device recordings yet.</p><p>Enable automatic tracking or start an activity. Your history will appear in Trips, and your routes in Map.</p></div>}</>}
 {tab==='Record'&&<RecorderPanel state={recording.state} run={recording.run} busy={recording.busy} error={recording.error} vehicles={vehicles} onFinished={trip=>{setSelected(trip);setTab('Trips');}}/>}
 {tab==='Trips'&&!selected&&<div className="social-sections activities-switch" role="group" aria-label="Activities or segments">{[['activities','Activities'],['segments','Segments']].map(([id,label])=><button key={id} type="button" aria-pressed={activitiesView===id} onClick={()=>setActivitiesView(id)}>{label}</button>)}</div>}
 {tab==='Trips'&&activitiesView==='segments'&&!selected&&<SegmentsView owner={session.user.id} journeys={realJourneys} receipts={auth.preferences.syncReceipts} position={mapLocation.position} onLocate={()=>void mapLocation.locate()} unit={unit} onOpen={openSegmentDetail} onOpenActivity={id=>{const trip=realJourneys.find(entry=>entry.id===id);if(trip)setSelected(trip);}} version={segmentsVersion}/>}
 {tab==='Trips'&&activitiesView==='activities'&&<>{localContext.incomplete&&<p className="notice" role="alert">This local journey has more related recordings than can be shown together. Open an original recording to review it.</p>}{grouping.sourceContextIncomplete&&<p className="notice" role="status">Overlapping phone and car recordings need saved route details to verify source matching. Open a recording to load its matching context.</p>}{cloudJournal.paged&&<button className="text-button" onClick={cloudJournal.refresh}>Back to newest activities</button>}{cloudJournal.loading&&<LoadingMark label="Loading saved activity summaries"/>}{(cloudJournal.error||scopeState.error)&&<p className="notice" role="alert">{cloudJournal.error||scopeState.error}</p>}{cloudJournal.more&&<button className="text-button" disabled={cloudJournal.loading} onClick={cloudJournal.loadMore}>Load more saved activities</button>}{fleet.error&&vehicles.some(v=>v.source==='tesla')&&<p role="status" className="notice">{fleet.error}</p>}{fleet.more&&<button className="text-button" disabled={fleet.loadingMore} onClick={fleet.loadMore}>{fleet.loadingMore?<LoadingMark label="Loading older Tesla journeys" inline/>:'Load older Tesla journeys'}</button>}
{lastArchived&&<div className="trip-archive-toast" role="status"><span>Archived “{lastArchived.title}”</span><button type="button" onClick={()=>restoreTrip(lastArchived.id)}>Undo</button></div>}
{tripSearchOpen&&<div className="trip-expanded-search"><Search size={19}/><input ref={tripSearchRef} type="search" aria-label="Search all activity history" placeholder="Search places, activities, tags, dates…" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button type="button" aria-label="Clear search" onClick={()=>setQuery('')}><X size={18}/></button>}</div>}
<FilterToolbar className="map-filter-toolbar activity-filter-toolbar" label="Activity filter options" orientation="horizontal" toolbar={tripToolbar} onAction={tripFilterAction} onClose={closeTripFilters}/>
{activeEquipmentFilter&&<div className="trip-active-filters"><button type="button" className="trip-filter-chip" aria-label={`Remove equipment filter ${activeEquipmentName}`} onClick={()=>setEquipmentFilter('')}>Using {activeEquipmentName}<X size={14} aria-hidden="true"/></button></div>}
{selectingMerge&&<div className="trip-merge-hint" role="status"><span>{pickedMergeIDs.length?`${pickedMergeIDs.length} selected`:'Tap the activities to merge'}</span><span className="trip-merge-hint-actions"><button type="button" className="text-button" onClick={stopMerging}>Cancel</button><button type="button" className="primary" disabled={pickedMergeIDs.length<2||grouping.busy} onClick={()=>setMergeConfirm(true)}><GitMerge size={16} aria-hidden="true"/> Merge{pickedMergeIDs.length>1?` ${pickedMergeIDs.length}`:''}</button></span></div>}
{!searchingAllDates&&<div className="trip-date-navigator" role="group" aria-label="Browse journey dates"><button type="button" aria-label="Previous day" onClick={()=>{setDateChosen(true);setDayFilter(shiftDate(dayFilter,-1,today));}}><ChevronRight className="trip-prev-icon" size={18}/></button><div className="trip-date-current"><input ref={tripDateInput} type="date" aria-hidden="true" tabIndex={-1} value={chosenDay(dayFilter,today)||''} max={today} onChange={e=>{if(e.target.value)setDayFilter(e.target.value>=today?'today':e.target.value);}}/><button type="button" aria-label={`Choose journey date, ${dateLabel(dayFilter,today)}`} onClick={()=>openDatePicker(tripDateInput.current)}><span>{dateLabel(dayFilter,today)}</span></button></div><button type="button" aria-label="Next day" disabled={!canShiftForward(dayFilter,today)} onClick={()=>setDayFilter(shiftDate(dayFilter,1,today))}><ChevronRight size={18}/></button>{dayFilter!=='all'&&<button type="button" className="trip-date-today" aria-label={dayFilter==='today'?'Show all dates':'Return to Today'} onClick={()=>setDayFilter(dayFilter==='today'?'all':'today')}>{dayFilter==='today'?'All':'Today'}</button>}</div>}
<div className="section-heading trip-results-heading"><div><h2>{filtered.length} {filtered.length===1?'activity':'activities'}</h2><p className="muted small-copy">{showArchived?'Archived · ':''}{searchingAllDates?'Searching all dates · ':dayFilter!=='all'?`${dateLabel(dayFilter,today)} · `:''}{sort==='duration'?`${Math.floor(filtered.reduce((sum,t)=>sum+t.durationSeconds,0)/60)} min recorded · Longest first`:sort==='distance'?`${filtered.some(t=>t.distanceEstimate)?'~':''}${distanceText(filtered.reduce((sum,t)=>sum+t.distanceMeters,0)/1000,unit)} total · Longest first`:'Newest first'}</p></div><button type="button" className={`trip-shared-toggle${includeSharedActivities?' is-active':''}`} aria-pressed={includeSharedActivities} aria-label={includeSharedActivities?'Showing activities shared with you. Tap to show only yours.':'Showing only your activities. Tap to also show activities friends and family shared with you.'} onClick={()=>setIncludeSharedActivities(value=>!value)}><Users size={16} aria-hidden="true"/><span>{includeSharedActivities&&!sharedFeed.loading?`Shared with me · ${filtered.filter(t=>t.isShared).length}`:'Shared with me'}</span>{includeSharedActivities&&<Check size={15} aria-hidden="true"/>}</button></div>
<div className="trip-source-switch" role="group" aria-label="Show activities recorded">{[['all','All',Layers],['automatic','Auto',Sparkles],['manual','Manual',Hand]].map(([value,label,Icon])=><button key={value} type="button" aria-pressed={activitySourceChoice===value} className={activitySourceChoice===value?'is-active':''} onClick={()=>chooseActivitySource(value)} aria-label={value==='all'?'All activities':value==='automatic'?'Automatic activities, detected and recorded by your phone':'Manual activities, started by you'}><Icon size={15} aria-hidden="true"/><span>{label}</span><small>{sourceCounts[value]}</small></button>)}</div>
{includeSharedActivities&&sharedFeed.error&&<p role="alert" className="notice">{sharedFeed.error}</p>}{includeSharedActivities&&sharedFeed.loading&&<LoadingMark label="Loading shared activities"/>}
{filtered.length?<TripsList key={`${filter}|${activitySourceChoice}|${dayFilter}|${favouritesOnly}|${activeEquipmentFilter}|${sort}|${showArchived}|${includeSharedActivities}`} journeys={filtered} sharing={mySharing} photos={peopleAvatars.photos} unit={unit} sort={sort} query={query} favourites={saved} vehicles={vehicles} busy={grouping.busy||recording.busy||scopeState.loading||Boolean(scopeState.error)} showArchived={showArchived} selecting={selectingMerge} selectedIDs={pickedMergeIDs} onOpen={trip=>{if(trip.isShared){setOpenSocialJourney(trip.sharedActivityID);}else setSelected(trip);}} onBookmark={bookmarkRow} onEquipment={openEquipment} onArchive={archiveRow} onDelete={trip=>{setDeleteError('');setDeleteTrip(trip);}} onRestore={restoreRow} onToggleSelect={id=>setMergeIDs(ids=>ids.includes(id)?ids.filter(x=>x!==id):[...ids,id])}/>:cloudJournal.loading||scopeState.loading?<LoadingMark label="Loading saved history"/>:cloudJournal.error||scopeState.error?<p role="alert" className="notice">Saved history is unavailable. Reconnect or retry; cached recordings have been preserved.</p>:<div className="empty"><Search/><h2>{dayFilter==='today'?'No activities today':'No journeys found'}</h2><p>{dayFilter==='today'?'Activities you record today appear here.':'Try a different place, date or activity.'}</p><button className="secondary" onClick={resetTripFilters}>{dayFilter==='today'?'Show all activities':'Clear filters'}</button></div>}</>}

 {selectingMerge&&mergeConfirm&&pickedMergeIDs.length>1&&<div className="modal-backdrop" role="presentation"><div className="notice" role="dialog" aria-modal="true" aria-label="Merge journeys" style={{maxWidth:440,margin:'auto',padding:24}}><h2>Merge {pickedMergeIDs.length} activities?</h2><p>The selected activities become one activity with their combined route, time and photos. The originals are replaced.</p><p className="muted small-copy">This cannot be undone. Only activities recorded on this iPhone or Apple Watch can be merged.</p>{mergeError&&<p role="alert" className="error">{mergeError}</p>}<div className="detail-actions"><button className="secondary" onClick={()=>setMergeConfirm(false)}>Back</button><button className="primary" disabled={recording.busy} onClick={confirmMerge}>{recording.busy?'Merging…':'Yes, merge'}</button></div></div></div>}
 {tab==='Social'&&<div className="social-layout social-redesign"><div className="social-sections" role="group" aria-label="Social sections"><button type="button" aria-pressed={socialSection==='friends'} onClick={()=>setSocialSection('friends')}>Friends</button><button type="button" aria-pressed={socialSection==='household'} onClick={()=>setSocialSection('household')}>Household</button></div>{socialSection==='friends'?<><HouseholdRequests onJoined={refreshHousehold}/><Friends personPhotos={peopleAvatars.photos} selfId={session.user.id} selfAvatar={auth.preferences.avatar} onHouseholdJoined={()=>{refreshHousehold();if(pendingInvitation?.fromHousehold)setSocialSection('household');}} household={householdMembers} peopleById={peopleById} sharing={{enabled:friendsLocation.enabled,ready:friendsLocation.ready!==false,error:friendsLocation.error,onChange:friendsLocation.setSharing}} permission={recording.state.permission} precise={recording.state.precise} onShowPerson={showOnMap} onOpenLocations={openLocations} invitationCode={pendingInvitation?.kind==='friend'?pendingInvitation.code:null} invitationPreview={pendingInvitation?.fromHousehold?pendingInvitation.preview:null} onInviteConsumed={consumeInvitation} onShareLive={()=>friendsLocation.setSharing(true)}/></>:<><Household onReviewInvitation={(code,preview)=>{setPendingInvitation({kind:'friend',code,preview,fromHousehold:true});setSocialSection('friends');}} invitationCode={pendingInvitation?.kind==='household'?pendingInvitation.code:null} onInviteConsumed={consumeInvitation} personPhotos={peopleAvatars.photos} selfId={session.user.id} selfAvatar={auth.preferences.avatar} onMembershipChanged={refreshHousehold} onShareLive={()=>presence.setLiveSharing(true)} onStopLive={()=>presence.setLiveSharing(false)} liveEnabled={presence.liveEnabled} liveReady={presence.liveReady} liveError={presence.liveError} onRetrySharing={presence.refreshLive} permission={recording.state.permission} precise={recording.state.precise} peopleById={peopleById} selfLocation={selfLocation} onShowMember={showOnMap} onOpenMap={openPeopleMap} onOpenLocations={openLocations} vehicles={vehicles} onSaveVehicles={setVehicles}/><HouseholdTrips activities={grouping.records}/></>}</div>}

 {tab==='Map'&&!openSocialJourney&&<>{cloudJournal.more&&<p className="muted small-copy" role="status">Some saved activities are not loaded yet. <button type="button" className="text-button" disabled={cloudJournal.loading} onClick={cloudJournal.loadMore}>Load more</button></p>}{(scopeState.error||cloudJournal.error)&&<p role="alert" className="notice">{scopeState.error||cloudJournal.error}</p>}<div className={`map-explorer map-social-explorer map-page map-page-people`}>
 <h1 className="sr-only">Map</h1>
 <MapPersonBar people={everyone} driveTimes={driveTimes} selected={mapPersonSel?.userId??null} selectedName={mapPersonSel?.name} viewer={session.user.id} photos={peopleAvatars.photos} selfAvatar={auth.preferences.avatar} onSelect={userId=>{const person=userId?(userId===session.user.id?{userId,name:'You'}:everyone.find(p=>p.userId===userId)):null;setMapPersonSel(person?{userId:person.userId,name:person.name}:null);if(person)setMapPanel(open=>open==='filters'?null:open);}}/>
 {socialMapEnabled&&socialMap.loading&&<LoadingMark label="Loading friends’ journeys"/>}{socialMapEnabled&&socialMap.error&&<p role="alert" className="error">{socialMap.error}</p>}
 <>
 <PersonMap viewState={mapViewState} onViewChange={setMapViewState} unit={unit} person={mapPerson} personPin={selectedPersonPin} selfPin={myLocationPin} viewer={session.user.id} locateSelf={()=>mapLocation.locate()} onOpenOwn={openOwnActivity} onOpenShared={openSharedOnMap} localTrips={recording.state.trips} localLiveTrip={recording.state.automaticTrip||recording.state.active||recording.state.trips?.find(t=>t.id===recording.state.automaticSettledTripID)} deletedIDs={recording.state.deletedIDs} renderMap={personDay=><JourneyMap resumeFullscreen={mapResume?.fullscreen?mapResume.request:0} onResumeFullscreen={resumedFullscreen} personDay={personDay} segmentLayer={mapView.segments?mapSegments.segments:null} onRegion={setMapArea} onSegment={mapView.segments?openSegmentDetail:null} journeys={combinedMapJourneys} overview={socialMapEnabled?null:overview} controls={mapControls(mapView,mapPanel,mapActivities,today,archivedTrips.length,socialMapEnabled)} onControl={mapAction} onJourney={journey=>{rememberMapOrigin();if(journey.sharedActivityID)setOpenSocialJourney(journey.sharedActivityID);else setSelected(journey);}} viewportKey={0} camera={cameraIntent(camera,session.user.id,Boolean(overview))} onCamera={onMapCamera} onPhoto={(journey,photoID)=>{if(journey.sharedActivityID)setOpenSocialJourney(journey.sharedActivityID);else openPhoto(journey,photoID);}} peoplePins={mapPeople} large  locating={mapLocation.loading} onLocate={async()=>{const position=await mapLocation.locate();if(position){dispatchCamera({type:'focus',personId:'self'});}return position;}}/>}/>{mapLocation.error&&<p role="status" className="notice">{mapLocation.error}</p>}{recorderAvailable()&&!['always','whenInUse'].includes(recording.state.permission)&&<p role="status" className="notice">Allow location access in iOS Settings to show yourself on the map. No earlier position is shown as current.</p>}{overview&&overview.included<overview.total&&<p className="muted small-copy">Route density from your {overview.included} most recent of {overview.total} journeys.</p>}{mapView.routes&&!combinedMapJourneys.length&&<p className="muted small-copy" role="status">No routes match these layers.</p>}{overviewState.pending&&<p className="muted small-copy" role="status">Drawing routes…</p>}{overviewState.error&&<div className="notice" role="alert"><span>Routes could not be prepared. </span><button type="button" className="text-button" onClick={overviewState.retry}>Retry</button></div>}{mapView.segments&&mapSegments.status==='zoom'&&<p className="muted small-copy" role="status">Zoom in to see segments.</p>}{mapView.segments&&mapSegments.status==='idle'&&<p className="muted small-copy" role="status">Move the map to show segments here.</p>}{mapView.segments&&mapSegments.status==='error'&&<p className="notice" role="status">Segments could not be loaded for this area.</p>}</></div></>}

 {tab!=='Map'&&<footer className="page-footer"><span>Go somewhere. Keep the feeling.</span><span><Lock size={12}/> Your routes stay private</span></footer>}</div>}
 </HomeLocationRefresh><MobileNav tab={tab} recordState={recordControlState(recording.state,recording.busy)} onSelect={name=>{perfTap('tab:'+name);setTab(name);setSelected(null);setOpenSocialJourney(null);}}/>
 {deleteTrip&&<div className="modal-backdrop"><DismissibleSheet label="Delete activity" onClose={()=>{if(!recording.busy)setDeleteTrip(null);}}><div className="trip-delete-confirm">{(deleteError||recording.error)&&<p role="alert">{recording.error||deleteError}</p>}<strong>Delete {deleteTrip.title}?</strong>{deletionIDs(deleteTrip).length>1&&<p>This deletes all {deletionIDs(deleteTrip).length} original activities in this journey.</p>}<p>This permanently removes the local activity and its saved route. Original photos in your library remain.</p><div className="detail-actions"><button type="button" className="secondary" disabled={recording.busy} onClick={()=>setDeleteTrip(null)}>Cancel</button><button type="button" className="primary" disabled={recording.busy} onClick={()=>void confirmTripDelete()}>Delete activity</button></div></div></DismissibleSheet></div>}
 {sheet&&<div className="modal-backdrop" onClick={()=>setSheet(null)}><DismissibleSheet key={sheet} onClose={()=>setSheet(null)} label={sheet==='recordingHealth'?'Recording health':sheet==='auth'?'Account access':sheet==='edit'?'Edit journey':sheet==='tracking'?'Tracking & Permissions':sheet==='diagnostics'?'Diagnostics':sheet==='feedback'?'Feedback & Support':sheet==='garage'?'My Collection':sheet==='equipment'?'Activity equipment':sheet==='places'?'Saved places':sheet==='householdPlaces'?'Locations':sheet==='nativeEdit'?'Edit activity':sheet==='historical'?'Add past activity':sheet==='segment'?'Segment':'Your profile'}><button className="close icon-button" aria-label="Close dialog" onClick={()=>setSheet(null)}><X/></button>
 {sheet==='profile'&&<><span className="sheet-icon"><ShieldCheck size={28}/></span><p className="eyebrow">YOUR LITTLE CORNER</p><h2>{auth.preferences.displayName||'Your private world.'}</h2><p className="muted">{session?.user.email||'Create an account to get ready for your own story.'}</p><NotificationList items={inbox.items.filter(item=>item.kind!=='poke')} onRead={inbox.markOneRead} onOpen={openNotification}/><div className="status-row"><Lock size={18}/><div><strong>Sharing & privacy</strong><p>Your routes are private. {presenceHidden?'Your live location is not shared.':'Location sharing is enabled.'} Choose who can see your location in Social.</p></div></div><div className="status-row"><Star size={18}/><div><strong>{saved.length} favourite activities</strong><p>Favourites help you find trips again. They do not change sharing permissions.</p></div></div><button type="button" className="secondary full feedback-entry" onClick={()=>setSheet('feedback')}><LifeBuoy size={17}/> Feedback &amp; Support {feedbackUnread>0&&<span className="notification-count">{feedbackUnread} new</span>}<ChevronRight size={16}/></button><div className="profile-tools"><button className="secondary full" onClick={()=>setSheet('diagnostics')}><Gauge size={17}/> Diagnostics</button><button className="secondary full" onClick={()=>setSheet('garage')}><CarIcon size={17}/> My Collection</button></div><div className="profile-tools"><button className="secondary full" onClick={()=>setSheet('places')}><MapPin size={17}/> Saved places</button></div><button className="primary full" onClick={()=>setSheet('account')}>Account & settings <ArrowRight size={18}/></button><button type="button" className="secondary full" onClick={()=>setSheet('tracking')}>Tracking & Permissions</button><small className="muted">Your activities remain private. Household setup does not enable location sharing.</small></>}
 {sheet==='recordingHealth'&&<RecordingHealthDetail health={recording.state.recordingHealth} run={recording.run} busy={recording.busy} error={recording.error}/>}
 {sheet==='places'&&<Places places={recording.state.places||NO_PLACES} run={recording.run} busy={recording.busy} error={recording.error}/>}
 {sheet==='householdPlaces'&&<HouseholdPlaces mapCenter={mapLocation.position} selfId={session.user.id} places={householdPlaces} memberPoints={peopleMembers.filter(member=>member.state==='live'&&member.position&&member.display_name)} peoplePins={allPeoplePins} refresh={refreshHouseholdPlaces} error={householdPlacesError} recorderRun={recording.run}/>}
 {sheet==='nativeEdit'&&<ActivityEditor trip={selected} vehicles={vehicles} run={recording.run} busy={recording.busy} error={recording.error} onSaved={(result,id)=>{const trip=result.trips.find(t=>t.id===id);if(trip)setSelected(recordedJourney(trip));setSheet(null);}}/>}
 {sheet==='diagnostics'&&<Diagnostics state={recording.state} session={session} preferences={auth.preferences} run={recording.run} refresh={recording.refresh}/>}
 {sheet==='feedback'&&<FeedbackSupport recording={recording}/>}
 {sheet==='segment'&&openSegment&&<SegmentDetail id={openSegment} unit={unit} onChanged={segmentsChanged} onDeleted={()=>{segmentsChanged();setSheet(null);setOpenSegment(null);}}/>}
 {sheet==='garage'&&<Garage vehicles={vehicles} onSave={setVehicles} tripCounts={equipmentTripCounts} onViewTrips={item=>{setEquipmentFilter(String(item.id));setDayFilter('all');setSheet(null);setSelected(null);setTab('Trips');}}/>}
 {sheet==='equipment'&&equipmentTarget&&<EquipmentSheet key={equipmentTarget.id} trip={equipmentTarget} vehicles={vehicles} onAssign={assignEquipment} onAddItem={addCollectionItem} onClose={()=>setSheet(null)} busy={recording.busy}/>}
 {sheet==='account'&&<AccountSettings recording={recording} onTracking={()=>setSheet('tracking')}/>}
 {sheet==='tracking'&&<TrackingPermissions recording={recording} onBack={()=>setSheet('account')}/>}

{error&&<p role="alert" className="error">{error}</p>}</DismissibleSheet></div>}
 {lightbox&&<div className="lightbox" role="dialog" aria-modal="true" aria-label="Journey photographs" onClick={e=>{if(e.target===e.currentTarget)setLightbox(null);}}><button type="button" className="close icon-button" aria-label="Close photographs" onClick={()=>setLightbox(null)}><X/></button><div className="photo-zoom-viewport" onTouchStart={e=>{if(e.touches.length===2)photoPinch.current={distance:Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY),zoom:photoZoom};}} onTouchMove={e=>{if(e.touches.length===2&&photoPinch.current){e.preventDefault();const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);setPhotoZoom(Math.max(1,Math.min(5,photoPinch.current.zoom*d/photoPinch.current.distance)));}}} onTouchEnd={()=>{photoPinch.current=null;}}><PrivateImage className="zoomable-photo" style={{transform:`scale(${photoZoom})`}} onDoubleClick={()=>setPhotoZoom(z=>z>1?1:2)} src={lightbox.trip.photos[lightbox.index].url} alt={lightbox.trip.photos[lightbox.index].caption}/></div><div className="photo-zoom-controls"><button type="button" aria-label="Zoom out" disabled={photoZoom<=1} onClick={()=>setPhotoZoom(z=>Math.max(1,z-.5))}>−</button><span>{Math.round(photoZoom*100)}%</span><button type="button" aria-label="Zoom in" disabled={photoZoom>=5} onClick={()=>setPhotoZoom(z=>Math.min(5,z+.5))}>+</button><button type="button" onClick={()=>setPhotoZoom(1)}>Reset</button></div><p>{lightbox.trip.photos[lightbox.index].caption}</p><div><button className="icon-button" aria-label="Previous photo" disabled={lightbox.index===0} onClick={()=>{setPhotoZoom(1);setLightbox({...lightbox,index:lightbox.index-1});}}><ArrowLeft/></button><span>{lightbox.index+1} / {lightbox.trip.photos.length} · {lightbox.trip.source?'Private photo':'Demo photo'}</span><button className="icon-button" aria-label="Next photo" disabled={lightbox.index===lightbox.trip.photos.length-1} onClick={()=>{setPhotoZoom(1);setLightbox({...lightbox,index:lightbox.index+1});}}><ArrowRight/></button></div></div>}
 </div></>;
}
