import {useEffect,useRef} from 'react';
import {App as NativeApp} from '@capacitor/app';
import {Capacitor} from '@capacitor/core';
import {useAuth} from '../lib/AuthContext.jsx';
import {supabase} from '../lib/supabase.js';
import {config} from '../lib/config.js';
import {syncPrivateActivities,syncSegmentEfforts,syncPublicSegments} from '../lib/cloudSync.js';
// Rides already recorded are checked against segments published since at most this
// often when nothing local changed (on the foreground or the two-minute check).
export const SEGMENT_CATCH_UP_MS=6*3600*1000;
import {syncCollections} from '../lib/collectionSync.js';
import {syncAccountSettings} from '../lib/settingsSync.js';
import {refreshJourneyMetadata} from '../lib/journeyMetadataStore.js';
import {BACKED_UP_EVENT,SYNC_NOW_EVENT} from '../lib/syncNow.js';
import {receiptPatch,saveSyncReceipts} from '../lib/syncReceipts.js';
import {notifySegmentsChanged} from '../lib/segmentEvents.js';
import {recorder} from '../lib/recorder.js';
// Foreground/offline-aware sync. Never deletes local photos or recorder files.
export default function AutoCloudSync({state,journeySync=null}){
 const auth=useAuth(),latest=useRef(null),running=useRef(false),lastAttempt=useRef(0),synced=useRef(null),again=useRef(false),segmentsCaughtUp=useRef(0),publishNow=useRef(null),reportedBackup=useRef({reason:'',at:0}),kick=useRef(null),retryTimer=useRef(null),startupTimer=useRef(null),startupPassed=useRef(false),lastToken=useRef(null);
 useEffect(()=>{latest.current={auth,state,journeySync};},[auth,state,journeySync]);
 useEffect(()=>{
  if(!supabase)return;
  let alive=true,listener,publishing=false,publishAgain=false,publicationTimer,publicationOwner=null,publicationReceipts={};
  async function publish(){
   if(!alive||document.visibilityState!=='visible'||!navigator.onLine)return;
   if(publishing){publishAgain=true;return;}
   const {auth:user,state:recordings}=latest.current;
   const owner=user.session?.user?.id;
   if(user.status!=='authenticated'||!owner||recordings?.ownerID?.toLowerCase()!==owner.toLowerCase())return;
   if(publicationOwner!==owner){publicationOwner=owner;publicationReceipts={};}
   publishing=true;
   try{
    const outcome=await syncPublicSegments(supabase,recordings,receiptPatch(user.preferences,publicationReceipts,{},true).syncReceipts,{owner,
     checkpoint:async receipts=>{const saved=await saveSyncReceipts(user.savePreferences,receipts,{},true);publicationReceipts=saved?.syncReceipts||receipts;}});
    if(outcome.published){segmentsCaughtUp.current=0;if(alive)notifySegmentsChanged();}
    if(outcome.pending)publishAgain=true;
   }catch{/* Account/storage/network failures leave every section durable for retry. */}
   finally{
    publishing=false;
    if(alive&&publishAgain){publishAgain=false;clearTimeout(publicationTimer);publicationTimer=setTimeout(()=>void publish(),250);}
   }
  }
  publishNow.current=publish;
  kick.current=()=>{if(running.current){again.current=true;return;}void sync(true);};
  async function sync(foreground=false){
   if(running.current||document.visibilityState!=='visible'||!navigator.onLine||(!foreground&&Date.now()-lastAttempt.current<120000))return;
   const {auth:user,state:recordings,journeySync:journeys}=latest.current;
   if(user.status!=='authenticated')return;
   const owner=user.session.user.id;
   const ownsRecordings=recordings?.ownerID?.toLowerCase()===owner.toLowerCase();
   if(!ownsRecordings&&!journeys)return;
   // Work only after something was saved, edited or deleted: an unchanged history
   // (the recorder's history token), places and settings need no backup pass.
   // Journey metadata is left out of this signature on purpose: it lives in Supabase and
   // is refreshed below, so reading it back never looks like a settings change.
   const {syncReceipts:_r,lastBackup:_b,...settings}=user.preferences;
   void _r;void _b;
   const signature=JSON.stringify([owner,recordings?.historyToken||null,recordings?.places||[],recordings?.deletedIDs||[],settings]);
   const journeysOnly=!ownsRecordings||signature===synced.current;
   // Nothing local changed, but other people may have published segments since.
   const segmentsDue=ownsRecordings&&journeysOnly&&Date.now()-segmentsCaughtUp.current>=SEGMENT_CATCH_UP_MS;
   if(journeysOnly&&!journeys&&!segmentsDue)return;
   running.current=true;lastAttempt.current=Date.now();
   try{
    // Settings and the Collection are small and independent of the route upload,
    // so one failing photo must not block them. The first failure is re-thrown
    // after every stage has been attempted; nothing local is removed.
    let failure=null,receipts=user.preferences.syncReceipts||{};
    const attempt=async(step)=>{try{receipts=(await step(receipts)).receipts;}catch(error){failure=failure||error;}};
    if(!journeysOnly&&config.backupEnabled){
     await attempt(next=>syncAccountSettings(supabase,{owner:recordings.ownerID,preferences:user.preferences,receipts:next},{checkpoint:syncReceipts=>saveSyncReceipts(user.savePreferences,syncReceipts)}));
     await attempt(next=>syncCollections(supabase,{owner:recordings.ownerID,vehicles:user.preferences.vehicles,receipts:next},{checkpoint:syncReceipts=>saveSyncReceipts(user.savePreferences,syncReceipts)}));
    }
    // Journey metadata is Supabase's: this only refreshes the device's read-only cache of
    // it (start, return to the app, the periodic check). Nothing is uploaded here.
    if(journeys)await attempt(async next=>{
     await refreshJourneyMetadata({client:supabase,owner,...journeys});
     await journeys.flush();
     return {receipts:next};
    });
    if(!journeysOnly&&config.backupEnabled){
     // Each activity is checkpointed as it goes up, and household sharing is told straight away (it follows the backup, not a timer).
     const trips=await syncPrivateActivities(supabase,recordings,receipts,{maxActivities:20,publishSegments:false,throwOnFailure:false,onBackedUp:()=>window.dispatchEvent(new Event(BACKED_UP_EVENT)),checkpoint:syncReceipts=>saveSyncReceipts(user.savePreferences,syncReceipts)});
     receipts=trips.receipts;
     if(trips.pending)failure=failure||new Error('Activity backup continues in the next batch.');
     // Some activities may have been refused while the rest went up: those are reported (and retried when due), the rest stands.
     if(trips.problem)failure=failure||trips.problem;
     clearTimeout(retryTimer.current);
     if(alive&&Number.isFinite(trips.nextRetryAt)){retryTimer.current=setTimeout(()=>{synced.current=null;void kick.current?.();},Math.max(1000,trips.nextRetryAt-Date.now()+500));}
     if(alive)await saveSyncReceipts(user.savePreferences,receipts,{lastBackup:trips.lastSync});
     segmentsCaughtUp.current=Date.now();
    }else if(segmentsDue&&config.backupEnabled){
     const updated={...receipts};
     const efforts=await syncSegmentEfforts(supabase,recordings,updated,{owner,acknowledge:()=>saveSyncReceipts(user.savePreferences,{...updated})});
     // Unfinished work (more rides or segments) continues at the next check.
     if(!efforts.pending&&!efforts.failure)segmentsCaughtUp.current=Date.now();
     if(efforts.failure)failure=failure||efforts.failure;
    }
    if(failure)throw failure;
    synced.current=signature;
   }catch(error){
    // The Settings screen reports backup status and failures. Nothing local is deleted. The reason also goes to the
    // diagnostic log (once per distinct reason per ten minutes), so a report shows why activities are not reaching the cloud.
    const reason=String(error?.key||error?.message||'Backup failed'),now=Date.now();
    if(reportedBackup.current.reason!==reason||now-reportedBackup.current.at>600000){reportedBackup.current={reason,at:now};try{void recorder.noteBackupFailure(String(error?.message||reason));}catch{/* diagnostics only */}}
   }finally{
    running.current=false;
    // An explicit sync asked while this pass ran: run once more straight away.
    if(again.current&&alive){again.current=false;synced.current=null;void sync(true);}
   }
  }
  startupTimer.current=setTimeout(()=>{startupPassed.current=true;void sync();},5000);
  const periodic=setInterval(()=>{void publish();void sync(true);},120000);
  const resume=()=>{void publish();void sync(true);};
  // Explicit sync requests run a full pass even if nothing changed locally.
  const now=()=>{void publish();synced.current=null;if(running.current)again.current=true;else void sync(true);};
  window.addEventListener(SYNC_NOW_EVENT,now);
  window.addEventListener('online',resume);document.addEventListener('visibilitychange',resume);
  if(Capacitor.isNativePlatform())void NativeApp.addListener('appStateChange',({isActive})=>{if(isActive)resume();}).then(handle=>{if(alive)listener=handle;else void handle.remove();}).catch(()=>{});
  return()=>{alive=false;publishNow.current=null;clearTimeout(publicationTimer);clearTimeout(startupTimer.current);clearInterval(periodic);window.removeEventListener(SYNC_NOW_EVENT,now);window.removeEventListener('online',resume);document.removeEventListener('visibilitychange',resume);void listener?.remove();};
 },[]);
 // Sign-in and native account binding can finish after the initial timer.
 // Start once ownership is ready instead of waiting for the periodic check.
 useEffect(()=>{
  if(!startupPassed.current||auth.status!=='authenticated'||!state?.ownerID||state.ownerID.toLowerCase()!==auth.session?.user?.id?.toLowerCase())return undefined;
  clearTimeout(startupTimer.current);
  const timer=setTimeout(()=>void kick.current?.(),2500);
  return()=>clearTimeout(timer);
 },[auth.status,auth.session?.user?.id,state?.ownerID]);
 // A native save already emits journeysChanged and useRecorder refreshes the
 // authoritative snapshot. React then kicks the same stage immediately, even
 // while an unrelated private route/photo backup is still awaiting the network.
 useEffect(()=>{void publishNow.current?.();},[auth.status,auth.session?.user?.id,state?.ownerID,state?.historyToken,state?.trips]);
 // A recording that has just finished is backed up within seconds while the app is open, not at the next two-minute check.
 useEffect(()=>{
  const token=state?.historyToken||null,previous=lastToken.current;
  lastToken.current=token;
  // Not on first sight of the history (the app opening has its own pass); only when it changes.
  if(!token||!previous||token===previous)return undefined;
  const timer=setTimeout(()=>void kick.current?.(),2500);
  return()=>clearTimeout(timer);
 },[state?.historyToken]);
 useEffect(()=>()=>clearTimeout(retryTimer.current),[]);
 return null;
}
