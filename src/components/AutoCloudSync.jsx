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
import {runJourneySync} from '../lib/journeyMetadataStore.js';
import {SYNC_NOW_EVENT} from '../lib/syncNow.js';
import {receiptPatch,saveSyncReceipts} from '../lib/syncReceipts.js';
import {notifySegmentsChanged} from '../lib/segmentEvents.js';
// Foreground/offline-aware sync. Never deletes local photos or recorder files.
export default function AutoCloudSync({state,journeySync=null}){
 const auth=useAuth(),latest=useRef(null),running=useRef(false),lastAttempt=useRef(0),synced=useRef(null),again=useRef(false),segmentsCaughtUp=useRef(0),publishNow=useRef(null);
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
  async function sync(foreground=false){
   if(running.current||document.visibilityState!=='visible'||!navigator.onLine||(!foreground&&Date.now()-lastAttempt.current<120000))return;
   const {auth:user,state:recordings,journeySync:journeys}=latest.current;
   if(user.status!=='authenticated')return;
   const owner=user.session.user.id;
   const ownsRecordings=recordings?.ownerID?.toLowerCase()===owner.toLowerCase();
   if(!ownsRecordings&&!journeys)return;
   // Work only after something was saved, edited or deleted: an unchanged history
   // (the recorder's history token), places and settings need no backup pass.
   // Journey metadata is left out of this signature on purpose. It has its own queue
   // and revision, so renaming a journey sends one record instead of re-uploading a
   // day of routes and photos - and reading it back does not look like a settings
   // change on every two-minute check.
   const {syncReceipts:_r,lastBackup:_b,journeyGrouping:_g,journeyMetadataQueue:_q,journeyMetadata:_m,...settings}=user.preferences;
   void _r;void _b;void _g;void _q;void _m;
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
    // Titles, merges, tags and the answers derived for them are records, not one blob:
    // the queue is replayed and the revision carried over, so a retry is harmless.
    // Anything short of active stays queued and makes the pass count as unfinished, so
    // the next tick tries again instead of recording this state as already synced.
    if(journeys)await attempt(async next=>{
     const journey=await runJourneySync({client:supabase,owner,...journeys});
     await journeys.flush();
     if(journey.state!=='active'&&journey.state!=='idle')throw new Error(journey.error||'Journey metadata could not be stored in the cloud.');
     return {receipts:next};
    });
    if(!journeysOnly&&config.backupEnabled){
     const trips=await syncPrivateActivities(supabase,recordings,receipts,{maxActivities:20,publishSegments:false,checkpoint:syncReceipts=>saveSyncReceipts(user.savePreferences,syncReceipts)});
     receipts=trips.receipts;
     if(trips.pending)failure=failure||new Error('Activity backup continues in the next batch.');
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
   }catch{
    // The Settings screen is the explicit retry/error surface. Nothing local is deleted.
   }finally{
    running.current=false;
    // An explicit sync asked while this pass ran: run once more straight away.
    if(again.current&&alive){again.current=false;synced.current=null;void sync(true);}
   }
  }
  const starter=setTimeout(()=>void sync(),5000),periodic=setInterval(()=>{void publish();void sync(true);},120000);
  const resume=()=>{void publish();void sync(true);};
  // Explicit sync requests run a full pass even if nothing changed locally.
  const now=()=>{void publish();synced.current=null;if(running.current)again.current=true;else void sync(true);};
  window.addEventListener(SYNC_NOW_EVENT,now);
  window.addEventListener('online',resume);document.addEventListener('visibilitychange',resume);
  if(Capacitor.isNativePlatform())void NativeApp.addListener('appStateChange',({isActive})=>{if(isActive)resume();}).then(handle=>{if(alive)listener=handle;else void handle.remove();}).catch(()=>{});
  return()=>{alive=false;publishNow.current=null;clearTimeout(publicationTimer);clearTimeout(starter);clearInterval(periodic);window.removeEventListener(SYNC_NOW_EVENT,now);window.removeEventListener('online',resume);document.removeEventListener('visibilitychange',resume);void listener?.remove();};
 },[]);
 // A native save already emits journeysChanged and useRecorder refreshes the
 // authoritative snapshot. React then kicks the same stage immediately, even
 // while an unrelated private route/photo backup is still awaiting the network.
 useEffect(()=>{void publishNow.current?.();},[auth.status,auth.session?.user?.id,state?.ownerID,state?.historyToken,state?.trips]);
 return null;
}
