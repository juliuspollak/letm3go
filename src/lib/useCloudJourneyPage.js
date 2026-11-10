import {useEffect,useMemo,useRef,useState} from 'react';
import {supabase} from './supabase.js';
import {loadJourneyScope,ensureJourneyScope} from './journeyMetadataStore.js';
import {mergeScope,trimJourneyCache} from './journeyCache.js';
import {activityFromCloudRow} from './cloudActivity.js';
import {activityCode} from './activityNames.js';
const EMPTY=[];
export function cloudPageRequest({date='today',query='',activity='All activities',sort='newest',equipment=null,favourites=null,archived=[],showArchived=false},now=new Date()){
 let from=null,to=null;
 const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
 if(date==='today'||/^\d{4}-\d{2}-\d{2}$/.test(date)){
  const day=date==='today'?today:new Date(date+'T00:00:00');from=day.toISOString();to=new Date(day.getFullYear(),day.getMonth(),day.getDate()+1).toISOString();
 }else if(/^\d+d$/.test(date))from=new Date(now.getTime()-Number(date.slice(0,-1))*86400000).toISOString();
 return {p_list:true,p_from:from,p_to:to,p_query:query.trim(),p_activity:!activity||activity==='All activities'?null:activityCode(activity),p_sort:sort,p_equipment:equipment||null,p_favourite_refs:favourites?.map(id=>id.replace(/^journey:/,'').replace(/^linked:/,''))??null,p_archived_refs:archived.map(id=>id.replace(/^journey:/,'').replace(/^linked:/,'')),p_show_archived:showArchived};
}
export function useCloudJourneyPage({owner,sync,date='today',query='',activity='All activities',sort='newest',equipment=null,favourites=null,archived=[],showArchived=false}){
 const day=new Date().toLocaleDateString('en-CA');
 const filterKey=JSON.stringify([date,query,activity,sort,equipment,favourites,archived,showArchived,day]);
 const request=useMemo(()=>{const [date,query,activity,sort,equipment,favourites,archived,showArchived]=JSON.parse(filterKey);return cloudPageRequest({date,query,activity,sort,equipment,favourites,archived,showArchived});},[filterKey]),key=JSON.stringify([owner,request]);
 const [view,setView]=useState({key:null,ids:EMPTY,next:null,loading:false,error:''});
 const generation=useRef(0),busy=useRef(false),current=useRef(null);
 current.current={owner,sync,request,key};
 const load=async(more=false)=>{
  const input=current.current;if(more&&busy.current?.key===input.key)return;const turn=Symbol();generation.current=turn;busy.current={key:input.key,turn};
  setView(old=>old.key===input.key?{...old,loading:true,error:''}:{key:input.key,ids:EMPTY,next:null,loading:true,error:''});
  try{
   await input.sync.ready();
   const cached=input.sync.read().cache.pages?.[input.key];
   if(!navigator.onLine){
    if(!cached||!cached.ids.every(id=>input.sync.read().activityRows?.[id]))throw new Error('This history is not cached. Reconnect to load it.');
    if(turn===generation.current)setView({key:input.key,ids:cached.ids,next:cached.next,paged:cached.paged||false,loading:false,error:''});return;
   }
   const cursor=more?view.next:null;
   const fetched=await loadJourneyScope(supabase,input.owner,[],[],[],{...input.request,...(cursor?{p_before:cursor.at,p_before_id:cursor.id,p_before_metric:cursor.metric}: {})});
   if(turn!==generation.current||input.key!==current.current.key)return;
   const ids=[...new Set([...(more?view.ids:[]),...(fetched.pageRefs||[])])].slice(-100);
   await input.sync.write(latest=>{
    const next=mergeScope(latest,fetched,fetched.pageRefs||[],[]);
    next.cache={...next.cache,active:ids,pages:{...next.cache.pages,[input.key]:{ids,next:fetched.nextActivity,paged:more,at:Date.now()}}};
    return trimJourneyCache(next);
   });
   if(turn===generation.current)setView({key:input.key,ids,next:fetched.nextActivity,paged:more,loading:false,error:''});
  }catch(error){
   const cached=input.sync.read().cache.pages?.[input.key];
   if(turn===generation.current)setView(old=>({...(old.key===input.key?old:{ids:EMPTY,next:null}),...(cached&&cached.ids.every(id=>input.sync.read().activityRows?.[id])?{ids:cached.ids,next:cached.next}:{}),key:input.key,loading:false,error:error.message||'Saved activities are unavailable.'}));
  }
  finally{if(busy.current?.turn===turn)busy.current=null;}
 };
 const cursorRevision=sync.read().status?.cursorRevision;
 useEffect(()=>{
  const timer=setTimeout(()=>void load(),query?300:0);
  return()=>{clearTimeout(timer);generation.current=Symbol();};
 // The request key contains the complete filter; metadata revisions refresh summaries only.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[key,cursorRevision]);
 const scoped=view.key===key?view.ids:EMPTY;
 return {ids:scoped,paged:view.key===key&&Boolean(view.paged),loading:view.key!==key||view.loading,error:view.key===key?view.error:'',more:Boolean(view.next),loadMore:()=>load(true),refresh:()=>load(false)};
}
export async function loadCloudJourneyDetail({owner,sync,refs,client=supabase}){
 await sync.ready();
 const ids=[...new Set(refs)];if(ids.length>20)throw new Error('Open an original recording to view this large journey’s geometry.');
 const available=ids.every(id=>Array.isArray(sync.read().activityRows?.[id]?.route_points));
 if(available&&!navigator.onLine)return ids.map(id=>({...activityFromCloudRow(sync.read().activityRows[id],{detail:true}),cloudStale:true}));
 if(!available&&!navigator.onLine)throw new Error('This route is not cached. Reconnect to open it.');
 await ensureJourneyScope({client,owner,read:sync.read,write:sync.write},ids,ids,{force:!available});
 if(!ids.every(id=>Array.isArray(sync.read().activityRows?.[id]?.route_points)))throw new Error('Saved route is unavailable. Existing cached data was preserved.');
 await sync.write(latest=>trimJourneyCache({...latest,cache:{...latest.cache,active:ids}}));
 return ids.map(id=>activityFromCloudRow(sync.read().activityRows[id],{detail:true}));
}
