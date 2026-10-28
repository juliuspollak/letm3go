import {memo,useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Archive,ChevronRight,GitMerge,Search,Star} from 'lucide-react';
import ActivityIcon from './ActivityIcon.jsx';
import {EquipmentChip} from './EquipmentChip.jsx';
import {TRIP_PAGE_SIZE,canMergeTrip,tripMatchReason} from '../lib/tripsList.js';
import {distanceText,distanceUnitLabel,distanceValue} from '../lib/distanceUnits.js';

// `memo` is the point of this component: the recorder publishes a fresh snapshot
// every couple of seconds while a journey is live, and every place lookup rewrites
// preferences. Without it each of those commits re-rendered every row — including
// all their date formatting and equipment chips — in the middle of a scroll. Rows
// now only re-render when their own journey object or one of their flags changes.
const TripRow=memo(function TripRow({trip,unit,sort,query,favourite,swiped,dragging,dropTarget,mergeSelected,mergeCandidate,busy,showArchived,vehicles,onEquipment}){
 const mergeable=canMergeTrip(trip);
 const reason=query.trim()?tripMatchReason(trip,query,vehicles):null;
 return <div
  data-merge-id={mergeable?trip.id:undefined}
  data-trip-id={trip.id}
  draggable={mergeable&&!busy}
  className={`trip-list-row${dropTarget?' merge-drop-target':''}${dragging?' merge-dragging':''}${swiped?' trip-swiped':''}`}>
  <div className="trip-swipe-actions">
   <button type="button" className="trip-action-pin" data-action="pin" aria-label={`${favourite?'Unpin':'Pin'} ${trip.title}`}><Star size={20} fill={favourite?'currentColor':'none'}/><small>{favourite?'Unpin':'Pin'}</small></button>
   <button type="button" className="trip-action-archive" data-action="archive" aria-label={`${showArchived?'Restore':'Archive'}: ${trip.title}`}><Archive size={20}/><small>{showArchived?'Restore':'Archive'}</small></button>
  </div>
  <div className="trip-swipe-surface" style={{transform:swiped?'translateX(-132px)':undefined}}>
   <div className="recent-activity-row">
    <button type="button" className="trip-open-button" data-action="open" aria-label={`Open ${trip.title}`}><span className="recent-activity-icon"><ActivityIcon activity={trip.activity} size={19}/></span><span className="recent-activity-info"><strong>{trip.title}</strong><small>{trip.isGroupedJourney?`${trip.segmentIDs.length} activities · ${trip.stops.length} stops`:trip.activity} · {new Date(`${trip.date}T12:00:00`).toLocaleDateString('en-AU',{day:'numeric',month:'short'})}</small>{trip.provisional&&<small className="trip-provisional">Stopped · saved, may continue</small>}{reason&&<small className="trip-search-reason"><Search size={12}/>{reason.label}: <strong>{reason.value}</strong></small>}<small>{new Date(trip.startedAt*1000).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'})} – {trip.endedAt!=null?new Date(trip.endedAt*1000).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'}):'Recording'}</small></span><span className="recent-activity-distance">{sort==='duration'?<>{Math.floor(trip.durationSeconds/60)} <small>min</small><small className="trip-time-distance">{distanceText(trip.distance,unit)}</small></>:<>{distanceValue(trip.distance,unit)} <small>{distanceUnitLabel(unit)}</small></>}</span></button>
    <EquipmentChip trip={trip} items={vehicles} onOpen={onEquipment} fallback={<ChevronRight size={16} aria-hidden="true"/>}/>
   </div>
   <button type="button" className="icon-button trip-row-bookmark" data-action="pin" aria-pressed={favourite} title={favourite?'Remove from favourites':'Add to favourites'} aria-label={`${favourite?'Remove from':'Add to'} favourites: ${trip.title}`}><Star size={17} fill={favourite?'currentColor':'none'}/></button>
   {mergeable&&<button type="button" className="text-button trip-merge-button" data-action="merge" disabled={busy} aria-label={mergeCandidate?`Merge with ${trip.title}`:`Select ${trip.title} to merge`} title={mergeCandidate?'Merge with this drive':mergeSelected?'Selected for merging':'Merge with another drive'}><GitMerge size={17} aria-hidden="true"/></button>}
  </div>
 </div>;
});


// One delegated listener per gesture type instead of five per row keeps memoised
// rows from ever seeing a new callback identity.
export default function TripsList({journeys,unit,sort,query,favourites,vehicles,busy,showArchived,mergeSource,mergeTarget,onOpen,onBookmark,onEquipment,onArchive,onRestore,onMergeSelect,onMergeTarget}){
 const [swiped,setSwiped]=useState(null);
 const [dragging,setDragging]=useState(null);
 const [dropTarget,setDropTarget]=useState(null);
 const [floating,setFloating]=useState(null);
 const [point,setPoint]=useState(null);
 const [limit,setLimit]=useState(TRIP_PAGE_SIZE);
 const latest=useRef({});
 const swipe=useRef(null);
 const merge=useRef(null);
 const drop=useRef(null);
 const timer=useRef(null);
 const suppress=useRef(false);
 const sentinel=useRef(null);
 // Handlers read the newest props through a ref so the callbacks handed to memoised
 // rows never change identity. Written in an effect because a ref must not be
 // mutated during render.
 useEffect(()=>{latest.current={journeys,mergeSource,mergeTarget,dropTarget,swiped,busy,showArchived,onOpen,onBookmark,onEquipment,onArchive,onRestore,onMergeSelect,onMergeTarget};});
 const openEquipment=useCallback(trip=>latest.current.onEquipment(trip),[]);
 const handlers=useMemo(()=>{
  const rowID=target=>target?.closest?.('[data-trip-id]')?.dataset.tripId||null;
  const find=id=>latest.current.journeys?.find(trip=>trip.id===id)||null;
  const reset=()=>{drop.current=null;clearTimeout(timer.current);timer.current=null;merge.current=null;setFloating(null);setPoint(null);setDropTarget(null);};
  const startMerge=(event,trip)=>{
   if(!canMergeTrip(trip)||event.touches.length!==1||latest.current.mergeTarget)return;
   if(event.target?.closest?.('.trip-equipment-chip'))return;
   const touch=event.touches[0];
   clearTimeout(timer.current);
   merge.current={id:trip.id,origin:{x:touch.clientX,y:touch.clientY},active:false};
   timer.current=setTimeout(()=>{
    if(!merge.current||merge.current.id!==trip.id)return;
    merge.current.active=true;
    suppress.current=true;
    setFloating({id:trip.id,title:trip.title,activity:trip.activity,distance:trip.distance});
    setPoint(merge.current.origin);
    latest.current.onMergeSelect(trip.id);
   },360);
  };
  const moveMerge=event=>{
   const gesture=merge.current;
   if(!gesture||event.touches.length!==1)return;
   const touch=event.touches[0],x=touch.clientX,y=touch.clientY;
   if(!gesture.active){if(Math.hypot(x-gesture.origin.x,y-gesture.origin.y)>9)reset();return;}
   event.preventDefault();
   setPoint({x,y});
   const id=document.elementFromPoint?.(x,y)?.closest?.('[data-merge-id]')?.dataset.mergeId;
   const target=id&&id!==gesture.id?id:null;
   drop.current=target;
   setDropTarget(target);
  };
  const endMerge=()=>{
   const gesture=merge.current,target=drop.current;
   const active=Boolean(gesture?.active);
   if(active&&target&&target!==gesture.id){latest.current.onMergeSelect(gesture.id);latest.current.onMergeTarget(target);}
   reset();
   if(active)setTimeout(()=>{suppress.current=false;},400);
  };
  return {
   click(event){
    const action=event.target?.closest?.('[data-action]')?.dataset.action;
    const id=action&&rowID(event.target);
    const trip=id&&find(id);
    if(!trip)return;
    if(action==='open'){if(suppress.current){suppress.current=false;return;}latest.current.onOpen(trip);}
    else if(action==='pin')latest.current.onBookmark(id);
    else if(action==='archive'){setSwiped(null);if(latest.current.showArchived)latest.current.onRestore(id);else latest.current.onArchive(trip);}
    else if(action==='merge'){
     if(latest.current.mergeSource&&latest.current.mergeSource!==id)latest.current.onMergeTarget(id);
     else{latest.current.onMergeSelect(id);latest.current.onMergeTarget(null);}
    }
   },
   touchStart(event){
    if(event.touches.length!==1)return;
    const row=event.target?.closest?.('[data-trip-id]');
    const trip=row&&find(row.dataset.tripId);
    if(!trip)return;
    const touch=event.touches[0];
    swipe.current={id:trip.id,row,x:touch.clientX,y:touch.clientY,dx:0,axis:null};
    startMerge(event,trip);
   },

   touchMove(event){
    const gesture=swipe.current;
    if(!gesture||event.touches.length!==1){moveMerge(event);return;}
    // Once the long press has lifted a card out of the row, every movement belongs to
    // the merge drag: treating a sideways pull as a swipe would cancel the drag.
    if(merge.current?.active){moveMerge(event);return;}
    const touch=event.touches[0],dx=touch.clientX-gesture.x,dy=touch.clientY-gesture.y;
    if(!gesture.axis&&Math.max(Math.abs(dx),Math.abs(dy))>10)gesture.axis=Math.abs(dx)>Math.abs(dy)*1.25?'horizontal':'vertical';
    if(gesture.axis!=='horizontal'){moveMerge(event);return;}
    gesture.dx=dx;
    if(merge.current)reset();
    if(event.cancelable)event.preventDefault();
    const surface=gesture.row.querySelector('.trip-swipe-surface');
    if(surface)surface.style.transform=`translateX(${Math.max(-285,Math.min(0,dx-(latest.current.swiped===gesture.id?132:0)))}px)`;
   },
   touchEnd(){
    const gesture=swipe.current;
    swipe.current=null;
    if(gesture){
     const surface=gesture.row.querySelector('.trip-swipe-surface');
     if(surface)surface.style.transform='';
    }
    if(gesture?.axis==='horizontal'){
     suppress.current=true;
     const trip=find(gesture.id);
     // A deliberate full-width swipe archives (or restores) straight away; a short
     // one reveals the actions so the same gesture cannot destroy data by accident.
     if(gesture.dx<-Math.min(window.innerWidth*0.55,260)&&trip)latest.current.onArchive(trip);
     else if(gesture.dx<-55)setSwiped(gesture.id);
     else if(gesture.dx>45)setSwiped(null);
     setTimeout(()=>{suppress.current=false;},350);
     return;
    }
    endMerge();
   },
   touchCancel(){swipe.current=null;reset();},
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


 // Stop the page scrolling behind the floating drag card, as the inline version did
 // while it still lived in App.
 useEffect(()=>{
  if(!floating)return;
  const block=event=>{if(event.cancelable)event.preventDefault();};
  document.addEventListener('touchmove',block,{passive:false});
  return()=>document.removeEventListener('touchmove',block);
 },[floating]);
 useEffect(()=>()=>clearTimeout(timer.current),[]);

 const list=journeys.slice(0,limit);
 const more=journeys.length>limit;
 useEffect(()=>{
  if(!more||typeof IntersectionObserver!=='function')return;
  const node=sentinel.current;
  if(!node)return;
  const observer=new IntersectionObserver(entries=>{
   if(entries.some(entry=>entry.isIntersecting))setLimit(value=>Math.min(value+TRIP_PAGE_SIZE,journeys.length));
  },{rootMargin:'400px 0px'});
  observer.observe(node);
  return()=>observer.disconnect();
 },[more,journeys.length]);

 return <>
  <div className="recent-activities trips-activity-list" onClick={handlers.click} onTouchStart={handlers.touchStart} onTouchMove={handlers.touchMove} onTouchEnd={handlers.touchEnd} onTouchCancel={handlers.touchCancel} onDragStart={handlers.dragStart} onDragOver={handlers.dragOver} onDragLeave={handlers.dragLeave} onDrop={handlers.drop} onDragEnd={handlers.dragEnd}>
   {list.map(trip=><TripRow key={trip.id} trip={trip} unit={unit} sort={sort} query={query} vehicles={vehicles} showArchived={showArchived} busy={busy} onEquipment={openEquipment} favourite={favourites.includes(trip.id)} swiped={swiped===trip.id} dragging={dragging===trip.id} dropTarget={dropTarget===trip.id} mergeSelected={mergeSource===trip.id} mergeCandidate={Boolean(mergeSource&&mergeSource!==trip.id)}/>)}
  </div>
  {more&&<><div className="trip-load-sentinel" ref={sentinel} aria-hidden="true"/><button type="button" className="secondary full trip-load-more" onClick={()=>setLimit(value=>Math.min(value+TRIP_PAGE_SIZE,journeys.length))}>Show more activities</button></>}
  {floating&&point&&<div className="merge-floating-card" style={{left:point.x,top:point.y}} aria-hidden="true"><span className="merge-floating-icon"><ActivityIcon activity={floating.activity} size={20}/></span><span className="merge-floating-copy"><strong>{floating.title}</strong><small>{distanceText(floating.distance,unit)} · Drop on another drive</small></span></div>}
 </>;
}

