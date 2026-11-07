import {activityLabel} from '../lib/activityNames.js';
import {memo,startTransition,useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Archive,ChevronRight,GitMerge,Search,Star,Trash2} from 'lucide-react';
import ActivityIcon from './ActivityIcon.jsx';
import {EquipmentChip} from './EquipmentChip.jsx';
import {TRIP_PAGE_SIZE,TRIP_PREFETCH_BATCH_SIZE,canMergeTrip,tripMatchReason,deletionIDs} from '../lib/tripsList.js';
import {distanceUnitLabel,tripDistanceValue,tripDistanceText} from '../lib/distanceUnits.js';

// `memo` is the point of this component: the recorder publishes a fresh snapshot
// every couple of seconds while a journey is live, and every place lookup rewrites
// preferences. Without it each of those commits re-rendered every row — including
// all their date formatting and equipment chips — in the middle of a scroll. Rows
// now only re-render when their own journey object or one of their flags changes.
const TripRow=memo(function TripRow({trip,formatters,unit,sort,query,favourite,swiped,dragging,dropTarget,mergeSelected,mergeCandidate,busy,showArchived,vehicles,onEquipment}){
 const shared=trip.isShared===true,mergeable=!shared&&canMergeTrip(trip),deletable=!shared&&deletionIDs(trip).length>0;
 const actionWidth=deletable?198:132;
 const reason=query.trim()?tripMatchReason(trip,query,vehicles):null;
 return <div
  data-merge-id={mergeable?trip.id:undefined}
  data-trip-id={trip.id}
  draggable={false}
  className={`trip-list-row${shared?' trip-shared-row':''}${dropTarget?' merge-drop-target':''}${dragging?' merge-dragging':''}${swiped?' trip-swiped':''}`}>
  {!shared&&<div className="trip-swipe-actions">
   <button type="button" className="trip-action-pin" data-action="pin" aria-label={`${favourite?'Unpin':'Pin'} ${trip.title}`}><Star size={20} fill={favourite?'currentColor':'none'}/><small>{favourite?'Unpin':'Pin'}</small></button>
   <button type="button" className="trip-action-archive" data-action="archive" aria-label={`${showArchived?'Restore':'Archive'}: ${trip.title}`}><Archive size={20}/><small>{showArchived?'Restore':'Archive'}</small></button>
   {deletable&&<button type="button" className="trip-action-delete" data-action="delete" disabled={busy} aria-label={`Delete: ${trip.title}`}><Trash2 size={20}/><small>Delete</small></button>}
  </div>
  <div className="trip-swipe-surface" style={{transform:!shared&&swiped?`translateX(-${actionWidth}px)`:undefined}}>
   <div className="recent-activity-row">
    <button type="button" className="trip-open-button" data-action="open" aria-label={`Open ${trip.title}`}><span className="recent-activity-icon"><ActivityIcon activity={activityLabel(trip.activity)} size={19}/></span><span className="recent-activity-info"><strong>{trip.title}</strong>{shared&&<small className="trip-shared-label"><span>Shared</span> · {trip.ownerName||'Friend'}</small>}<small>{trip.isGroupedJourney?`${trip.segmentIDs.length} activities · ${trip.stops.length} stops`:activityLabel(trip.activity)}{trip.source==='watch'&&!trip.isGroupedJourney?' · Apple Watch':''} · {formatters.date.format(new Date(`${trip.date}T12:00:00`))}</small>{trip.provisional&&<small className="trip-provisional">Stopped · saved, may continue</small>}{reason&&<small className="trip-search-reason"><Search size={12}/>{reason.label}: <strong>{reason.value}</strong></small>}<small>{formatters.time.format(trip.startedAt*1000)} – {trip.endedAt!=null?formatters.time.format(trip.endedAt*1000):'Recording'}</small></span><span className="recent-activity-distance">{sort==='duration'?<>{Math.floor(trip.durationSeconds/60)} <small>min</small><small className="trip-time-distance">{tripDistanceText(trip,unit)}</small></>:<span title={trip.distanceEstimate?'Estimated: includes GPS gaps':undefined}>{tripDistanceValue(trip,unit)} <small>{distanceUnitLabel(unit)}</small></span>}</span></button>
    {shared?<ChevronRight size={16} aria-hidden="true"/>:<EquipmentChip trip={trip} items={vehicles} onOpen={onEquipment} fallback={<ChevronRight size={16} aria-hidden="true"/>}/>}
   </div>
   <button type="button" className="icon-button trip-row-bookmark" data-action="pin" aria-pressed={favourite} title={favourite?'Remove from favourites':'Add to favourites'} aria-label={`${favourite?'Remove from':'Add to'} favourites: ${trip.title}`}><Star size={17} fill={favourite?'currentColor':'none'}/></button>
   {mergeable&&<button type="button" className="text-button trip-merge-button" draggable={mergeable&&!busy} data-action="merge" disabled={busy} aria-label={mergeCandidate?`Merge with ${trip.title}`:`Select ${trip.title} to merge`} title={mergeCandidate?'Merge with this drive':mergeSelected?'Selected for merging':'Merge with another drive'}><GitMerge size={17} aria-hidden="true"/></button>}
  </div>
 </div>;
});


// One delegated listener per gesture type instead of five per row keeps memoised
// rows from ever seeing a new callback identity.
export default function TripsList({journeys,unit,sort,query,favourites,vehicles,busy,showArchived,mergeSource,mergeTarget,onOpen,onBookmark,onEquipment,onArchive,onDelete,onRestore,onMergeSelect,onMergeTarget}){
 const timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone;
 const formatters=useMemo(()=>({
  date:new Intl.DateTimeFormat('en-AU',{day:'numeric',month:'short',timeZone}),
  time:new Intl.DateTimeFormat('en-AU',{hour:'numeric',minute:'2-digit',timeZone}),
 }),[timeZone]);
 const [swiped,setSwiped]=useState(null);
 const [dragging,setDragging]=useState(null);
 const [dropTarget,setDropTarget]=useState(null);
 const [limit,setLimit]=useState(TRIP_PAGE_SIZE);
 const latest=useRef({});
 const swipe=useRef(null);
 const journeyByID=useMemo(()=>new Map(journeys.map(trip=>[trip.id,trip])),[journeys]);
 const favouriteIDs=useMemo(()=>new Set(favourites),[favourites]);
 const suppress=useRef(false);
 const sentinel=useRef(null);
 // Handlers read the newest props through a ref so the callbacks handed to memoised
 // rows never change identity. Written in an effect because a ref must not be
 // mutated during render.
 useEffect(()=>{latest.current={journeyByID,mergeSource,mergeTarget,dropTarget,swiped,busy,showArchived,onOpen,onBookmark,onEquipment,onArchive,onDelete,onRestore,onMergeSelect,onMergeTarget};});
 const openEquipment=useCallback(trip=>latest.current.onEquipment(trip),[]);
 const handlers=useMemo(()=>{
  const rowID=target=>target?.closest?.('[data-trip-id]')?.dataset.tripId||null;
  const find=id=>latest.current.journeyByID?.get(id)||null;
  return {
   click(event){
    const action=event.target?.closest?.('[data-action]')?.dataset.action;
    const id=action&&rowID(event.target);
    const trip=id&&find(id);
    if(!trip)return;
    if(action==='open'){if(suppress.current){suppress.current=false;return;}latest.current.onOpen(trip);}
    else if(trip.isShared)return;
     else if(action==='pin')latest.current.onBookmark(id);
    else if(action==='archive'){setSwiped(null);if(latest.current.showArchived)latest.current.onRestore(id);else latest.current.onArchive(trip);}
    else if(action==='delete'&&!latest.current.busy&&deletionIDs(trip).length){setSwiped(null);latest.current.onDelete?.(trip);}
    else if(action==='merge'){
     if(latest.current.mergeSource&&latest.current.mergeSource!==id)latest.current.onMergeTarget(id);
     else{latest.current.onMergeSelect(id);latest.current.onMergeTarget(null);}
    }
   },
   pointerDown(event){
    if(event.pointerType!=='touch'||!event.isPrimary)return;
    const row=event.target?.closest?.('[data-trip-id]');
    const trip=row&&find(row.dataset.tripId);
    if(!trip)return;
    swipe.current={id:trip.id,row,pointerId:event.pointerId,x:event.clientX,y:event.clientY,dx:0,axis:null};
    // Touch pointers are implicitly captured by their original button. Keeping
    // that target preserves the delegated click after an ordinary tap.

   },

   pointerMove(event){
    const gesture=swipe.current;
    if(!gesture||event.pointerId!==gesture.pointerId)return;
    const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
    if(!gesture.axis&&Math.max(Math.abs(dx),Math.abs(dy))>10)gesture.axis=Math.abs(dx)>Math.abs(dy)*1.25?'horizontal':'vertical';
    if(gesture.axis!=='horizontal')return;
    gesture.dx=dx;
    gesture.row.classList.add('trip-swiping');
    const surface=gesture.row.querySelector('.trip-swipe-surface');
    if(surface)surface.style.transform=`translateX(${Math.max(-285,Math.min(0,dx-(latest.current.swiped===gesture.id?(deletionIDs(find(gesture.id)).length?198:132):0)))}px)`;
   },
   pointerUp(){
    const gesture=swipe.current;
    swipe.current=null;
    if(gesture){
     gesture.row.classList.remove('trip-swiping');
     const surface=gesture.row.querySelector('.trip-swipe-surface');
     if(surface)surface.style.transform=latest.current.swiped===gesture.id?`translateX(-${deletionIDs(find(gesture.id)).length?198:132}px)`:'';
    }
    if(gesture?.axis==='horizontal'){
     suppress.current=true;
     const trip=find(gesture.id);
     // A deliberate full-width swipe archives (or restores) straight away; a short
     // one reveals the actions so the same gesture cannot destroy data by accident.
     if(gesture.dx<-Math.min(window.innerWidth*0.55,260)&&trip){setSwiped(null);if(latest.current.showArchived)latest.current.onRestore(trip.id);else latest.current.onArchive(trip);}
     else if(gesture.dx<-55)setSwiped(gesture.id);
     else if(gesture.dx>45)setSwiped(null);
     setTimeout(()=>{suppress.current=false;},350);
     return;
    }
   },
   pointerCancel(){
    const gesture=swipe.current,surface=gesture?.row.querySelector('.trip-swipe-surface');
    gesture?.row.classList.remove('trip-swiping');
    if(surface)surface.style.transform=latest.current.swiped===gesture.id?`translateX(-${deletionIDs(find(gesture.id)).length?198:132}px)`:'';
    swipe.current=null;
   },
   dragStart(event){
    const id=rowID(event.target),trip=id&&find(id);
    if(!trip||!canMergeTrip(trip)||latest.current.busy)return;
    event.dataTransfer?.setData('text/plain',id);
    if(event.dataTransfer)event.dataTransfer.effectAllowed='move';
    latest.current.onMergeSelect(id);
    setDragging(id);
   },
   dragOver(event){
    const id=rowID(event.target),trip=id&&find(id);
    if(trip&&canMergeTrip(trip)&&latest.current.mergeSource&&latest.current.mergeSource!==id){event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='move';setDropTarget(id);}
   },
   dragLeave(event){
    const id=rowID(event.target);
    if(latest.current.dropTarget===id)setDropTarget(null);
   },
   drop(event){
    event.preventDefault();
    const id=rowID(event.target),trip=id&&find(id);
    const source=event.dataTransfer?.getData('text/plain')||latest.current.mergeSource;
    setDropTarget(null);
    setDragging(null);
    if(source&&trip&&source!==id&&canMergeTrip(trip)){latest.current.onMergeSelect(source);latest.current.onMergeTarget(id);}
   },
   dragEnd(){setDropTarget(null);setDragging(null);},
  };
 },[]);


 const list=useMemo(()=>journeys.slice(0,limit),[journeys,limit]);
 const more=journeys.length>limit;
 useEffect(()=>{
  if(!more||typeof IntersectionObserver!=='function')return;
  const node=sentinel.current;
  if(!node)return;
  const observer=new IntersectionObserver(entries=>{
   if(entries.some(entry=>entry.isIntersecting))startTransition(()=>setLimit(value=>Math.min(value+TRIP_PREFETCH_BATCH_SIZE,journeys.length)));
  },{rootMargin:'1000px 0px'});
  observer.observe(node);
  return()=>observer.disconnect();
 },[more,journeys.length,limit]);

 const rows=useMemo(()=>list.map(trip=><TripRow key={trip.id} trip={trip} formatters={formatters} unit={unit} sort={sort} query={query} vehicles={vehicles} showArchived={showArchived} busy={busy} onEquipment={openEquipment} favourite={favouriteIDs.has(trip.id)} swiped={swiped===trip.id} dragging={dragging===trip.id} dropTarget={dropTarget===trip.id} mergeSelected={mergeSource===trip.id} mergeCandidate={Boolean(mergeSource&&mergeSource!==trip.id)}/>),
  [list,formatters,unit,sort,query,vehicles,showArchived,busy,openEquipment,favouriteIDs,swiped,dragging,dropTarget,mergeSource]);

 return <>
  <div className="recent-activities trips-activity-list" onClick={handlers.click} onPointerDown={handlers.pointerDown} onPointerMove={handlers.pointerMove} onPointerUp={handlers.pointerUp} onPointerCancel={handlers.pointerCancel} onLostPointerCapture={handlers.pointerCancel} onDragStart={handlers.dragStart} onDragOver={handlers.dragOver} onDragLeave={handlers.dragLeave} onDrop={handlers.drop} onDragEnd={handlers.dragEnd}>
   {rows}
  </div>
  {more&&<><div className="trip-load-sentinel" ref={sentinel} aria-hidden="true"/><button type="button" className="secondary full trip-load-more" onClick={()=>setLimit(value=>Math.min(value+TRIP_PAGE_SIZE,journeys.length))}>Show more activities</button></>}

 </>;
}

