// The unread inbox behind the profile badge, and pokes. Notifications are written
// and pushed by the database (20261123000000, 20261124000000); the app only reads
// its own and marks them read.
import {useCallback,useEffect,useRef,useState} from 'react';
import {Capacitor} from '@capacitor/core';
import {App as NativeApp} from '@capacitor/app';
import {PushNotifications} from '@capacitor/push-notifications';
import {supabase} from './supabase.js';

export const FEEDBACK_KINDS=['feedback_new','feedback_reply','feedback_status'];
export const SEGMENT_KINDS=['segment_completed','segment_pb','segment_record','segment_changed','segment_removed'];
// The badge never shows more than this; above it reads "9+".
export const badgeText=count=>count>9?'9+':String(count);
const EMPTY=[];

export async function sendPoke(userID,client=supabase){
 if(!client)throw new Error('Sign in to poke someone.');
 const {data,error}=await client.rpc('send_poke',{p_to:userID});
 if(error)throw new Error(error.message||'The poke was not sent.');
 return data;
}

export async function loadUnread(client=supabase){
 const {data,error}=await client.from('notifications').select('id,kind,title,body,route,actor_id,created_at').is('read_at',null).order('created_at',{ascending:false}).limit(100);
 if(error)throw error;
 return data||EMPTY;
}

export function countKinds(items,kinds){return items.filter(item=>kinds.includes(item.kind)).length;}

// Earlier notifications for the Profile list, read or not.
export async function loadRecent(client=supabase,limit=30){
 const {data,error}=await client.from('notifications').select('id,kind,title,body,route,actor_id,created_at,read_at').order('created_at',{ascending:false}).limit(limit);
 if(error)throw error;
 return data||EMPTY;
}

// Where a notification (in the app or tapped in iOS) takes you.
export function notificationTarget(data){
 const screen=data?.screen||data?.route?.screen;
 const id=data?.id||data?.route?.id||null;
 if(screen==='feedback')return {screen:'feedback',id};
 if(screen==='segment'&&typeof id==='string'&&id)return {screen:'segment',id};
 if(screen==='review')return {screen:'review'};
 if(screen==='home')return {screen:'home'};
 return null;
}

// Refreshed on open, on return to the foreground and when a push arrives while the
// app is open. Never polled.
export function useNotifications(owner,{onOpen=()=>{}}={}){
 const [items,setItems]=useState(EMPTY);
 const [version,setVersion]=useState(0);
 const open=useRef(onOpen);
 useEffect(()=>{open.current=onOpen;},[onOpen]);
 const refresh=useCallback(()=>setVersion(value=>value+1),[]);
 useEffect(()=>{
  if(!owner||!supabase)return undefined;
  let active=true;
  (async()=>{
   try{const next=await loadUnread();if(active)setItems(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);}
   catch{/* keeps the last known badge */}
  })();
  return()=>{active=false;};
 },[owner,version]);
 useEffect(()=>{
  if(!owner)return undefined;
  let alive=true;const handles=[];
  const visible=()=>{if(document.visibilityState==='visible')refresh();};
  document.addEventListener('visibilitychange',visible);
  if(Capacitor.isNativePlatform()){
   const keep=promise=>promise.then(handle=>{if(alive)handles.push(handle);else void handle.remove();}).catch(()=>{});
   keep(NativeApp.addListener('appStateChange',({isActive})=>{if(isActive)refresh();}));
   keep(PushNotifications.addListener('pushNotificationReceived',()=>refresh()));
   keep(PushNotifications.addListener('pushNotificationActionPerformed',({notification})=>{
    refresh();const target=notificationTarget(notification?.data);if(target)open.current(target);
   }));
  }
  return()=>{alive=false;document.removeEventListener('visibilitychange',visible);for(const handle of handles)void handle.remove();};
 },[owner,refresh]);
 const markRead=useCallback(async kinds=>{
  if(!items.some(item=>!kinds||kinds.includes(item.kind)))return;
  setItems(current=>kinds?current.filter(item=>!kinds.includes(item.kind)):EMPTY);
  try{await supabase.rpc('mark_notifications_read',{p_kinds:kinds||null});}catch{refresh();}
  if(Capacitor.isNativePlatform())void PushNotifications.removeAllDeliveredNotifications().catch(()=>{});
 },[items,refresh]);
 // One notification opened from the Profile list.
 const markOneRead=useCallback(async id=>{
  setItems(current=>current.filter(item=>item.id!==id));
  // supabase-js reports a failed call in `error` rather than throwing.
  try{const {error}=await supabase.rpc('mark_notifications_read_ids',{p_ids:[id]});if(error)refresh();}catch{refresh();}
 },[refresh]);
 return {items,count:items.length,refresh,markRead,markOneRead};
}
