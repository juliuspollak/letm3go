import {activityLabel} from '../lib/activityNames.js';
import {memo,startTransition,useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Archive,Check,ChevronRight,Globe,Home,Search,Share2,Star,Trash2} from 'lucide-react';
import PersonAvatar from './PersonAvatar.jsx';
import ActivityIcon from './ActivityIcon.jsx';
import {EquipmentChip} from './EquipmentChip.jsx';
import {TRIP_PAGE_SIZE,TRIP_PREFETCH_BATCH_SIZE,canMergeTrip,tripMatchReason,deletionIDs} from '../lib/tripsList.js';
import {distanceUnitLabel,tripDistanceValue,tripDistanceText} from '../lib/distanceUnits.js';

// `memo` is the point of this component: the recorder publishes a fresh snapshot
// every couple of seconds while a journey is live, and every place lookup rewrites
// preferences. Without it each of those commits re-rendered every row — including
// all their date formatting and equipment chips — in the middle of a scroll. Rows
// now only re-render when their own journey object or one of their flags changes.
// My shared activity: who can see it, compactly (household, up to three friends).
function SharingIndicator({sharing,photos}){
 const shown=sharing.friends.slice(0,3),more=sharing.friends.length-shown.length;
 const label=sharing.audience==='public'?'Shared by public link':`Shared with ${[sharing.household?'household':null,sharing.friends.length?`${sharing.friends.length} friend${sharing.friends.length===1?'':'s'}`:null].filter(Boolean).join(' and ')}`;
 return <small className="trip-sharing" aria-label={label} title={label}><Share2 size={12} aria-hidden="true"/>{sharing.audience==='public'&&<Globe size={12} aria-hidden="true"/>}{sharing.household&&<Home size={12} aria-hidden="true"/>}
  {shown.map(friend=><PersonAvatar key={friend.id} size="xs" userId={friend.id} name={friend.name} photos={photos}/>)}{more>0&&<span>+{more}</span>}</small>;
}
const TripRow=memo(function TripRow({trip,formatters,unit,sort,query,favourite,swiped,selecting,picked,busy,showArchived,vehicles,onEquipment,sharing=null,photos=null}){
 const shared=trip.isShared===true,mergeable=!shared&&canMergeTrip(trip),deletable=!shared&&deletionIDs(trip).length>0;
 const actionWidth=66*(1+(showArchived?1:0)+(deletable?1:0));
 const reason=query.trim()?tripMatchReason(trip,query,vehicles):null;
 return <div
  data-trip-id={trip.id}
  draggable={false}
  className={`trip-list-row${shared?' trip-shared-row':''}${selecting?' trip-selecting':''}${selecting&&!mergeable?' trip-not-mergeable':''}${picked?' merge-selected':''}${swiped?' trip-swiped':''}`}>
  {!shared&&!selecting&&<div className="trip-swipe-actions">
   <button type="button" className="trip-action-pin" data-action="pin" aria-label={`${favourite?'Unpin':'Pin'} ${trip.title}`}><Star size={20} fill={favourite?'currentColor':'none'}/><small>{favourite?'Unpin':'Pin'}</small></button>
   {showArchived&&<button type="button" className="trip-action-archive" data-action="archive" aria-label={`${showArchived?'Restore':'Archive'}: ${trip.title}`}><Archive size={20}/><small>{showArchived?'Restore':'Archive'}</small></button>}
   {deletable&&<button type="button" className="trip-action-delete" data-action="delete" disabled={busy} aria-label={`Delete: ${trip.title}`}><Trash2 size={20}/><small>Delete</small></button>}
  </div>}
  <div className="trip-swipe-surface" style={{transform:!shared&&!selecting&&swiped?`translateX(-${actionWidth}px)`:undefined}}>
   {selecting&&<span className={`trip-pick${picked?' is-picked':''}${mergeable?'':' is-disabled'}`} aria-hidden="true">{picked&&<Check size={15} strokeWidth={3}/>}</span>}
   <div className="recent-activity-row">
    <button type="button" className="trip-open-button" data-action="open" aria-label={selecting?(mergeable?`${picked?'Deselect':'Select'} ${trip.title} for merging`:`${trip.title} cannot be merged`):`Open ${trip.title}`} aria-pressed={selecting&&mergeable?picked:undefined} disabled={selecting&&!mergeable}><span className="recent-activity-icon"><ActivityIcon activity={activityLabel(trip.activity)} size={19}/></span><span className="recent-activity-info"><strong className="trip-title-line">{shared&&<PersonAvatar size="xs" userId={trip.sharedOwnerID} name={trip.ownerName||'Friend'} photos={photos}/>}{shared&&<span className="sr-only">Shared by {trip.ownerName||'a friend'}: </span>}{trip.title}</strong>{!shared&&sharing&&<SharingIndicator sharing={sharing} photos={photos}/>}<small>{trip.isGroupedJourney?`${trip.segmentIDs.length} activities · ${trip.stops.length} stops`:activityLabel(trip.activity)}{trip.source==='watch'&&!trip.isGroupedJourney?' · Apple Watch':''} · {formatters.date.format(new Date(`${trip.date}T12:00:00`))}</small>{trip.provisional&&<small className="trip-provisional">Stopped · saved, may continue</small>}{reason&&<small className="trip-search-reason"><Search size={12}/>{reason.label}: <strong>{reason.value}</strong></small>}<small>{formatters.time.format(trip.startedAt*1000)} – {trip.endedAt!=null?formatters.time.format(trip.endedAt*1000):'Recording'}</small></span><span className="recent-activity-distance">{trip.activity==='Gym'?<>{Math.floor(trip.durationSeconds/60)} <small>min</small></>:sort==='duration'?<>{Math.floor(trip.durationSeconds/60)} <small>min</small><small className="trip-time-distance">{tripDistanceText(trip,unit)}</small></>:<span title={trip.distanceEstimate?'Estimated: includes GPS gaps':undefined}>{tripDistanceValue(trip,unit)} <small>{distanceUnitLabel(unit)}</small></span>}</span></button>
    {shared?<ChevronRight size={16} aria-hidden="true"/>:<EquipmentChip trip={trip} items={vehicles} onOpen={onEquipment} fallback={<ChevronRight size={16} aria-hidden="true"/>}/>}
   </div>
   {!shared&&<button type="button" className="icon-button trip-row-bookmark" data-action="pin" aria-pressed={favourite} title={favourite?'Remove from favourites':'Add to favourites'} aria-label={`${favourite?'Remove from':'Add to'} favourites: ${trip.title}`}><Star size={17} fill={favourite?'currentColor':'none'}/></button>}
  </div>
 </div>;
});


// One delegated listener per gesture type instead of five per row keeps memoised
// rows from ever seeing a new callback identity.
export default function TripsList({journeys,unit,sort,query,favourites,vehicles,busy,showArchived,selecting=false,selectedIDs=[],sharing=null,photos=null,onOpen,onBookmark,onEquipment,onArchive,onDelete,onRestore,onToggleSelect}){
 const timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone;
 const formatters=useMemo(()=>({
  date:new Intl.DateTimeFormat('en-AU',{day:'numeric',month:'short',timeZone}),
  time:new Intl.DateTimeFormat('en-AU',{hour:'numeric',minute:'2-digit',timeZone}),
 }),[timeZone]);
 const [swiped,setSwiped]=useState(null);
 const [limit,setLimit]=useState(TRIP_PAGE_SIZE);
 const latest=useRef({});
 const swipe=useRef(null);
 const pickedIDs=useMemo(()=>new Set(selectedIDs),[selectedIDs]);
 const journeyByID=useMemo(()=>new Map(journeys.map(trip=>[trip.id,trip])),[journeys]);
 const favouriteIDs=useMemo(()=>new Set(favourites),[favourites]);
 const suppress=useRef(false);
 const sentinel=useRef(null);
 // Handlers read the newest props through a ref so the callbacks handed to memoised
 // rows never change identity. Written in an effect because a ref must not be
 // mutated during render.
 useEffect(()=>{latest.current={journeyByID,selecting,swiped,busy,showArchived,unit,onOpen,onBookmark,onEquipment,onArchive,onDelete,onRestore,onToggleSelect};});
 const openEquipment=useCallback(trip=>latest.current.onEquipment(trip),[]);
 const handlers=useMemo(()=>{
  const rowID=target=>target?.closest?.('[data-trip-id]')?.dataset.tripId||null;
  const find=id=>latest.current.journeyByID?.get(id)||null;
  // The revealed actions' width, measured so it always matches what is drawn.
  const actionWidth=(row,id)=>row.querySelector('.trip-swipe-actions')?.offsetWidth||66*(1+(latest.current.showArchived?1:0)+(deletionIDs(find(id)).length?1:0));
  // Swipe: the surface follows the finger with transitions off (a data attribute,
  // which React never rewrites, unlike className). On release the final position is
  // written once, with the transition back on, and the state is set to match it, so
  // React's own style write is a no-op and the row animates exactly once.
  const settle=(gesture,open)=>{
   delete gesture.row.dataset.swiping;
   const surface=gesture.row.querySelector('.trip-swipe-surface');
   if(surface)surface.style.transform=open?`translateX(-${gesture.width}px)`:'';
  };
  // Where a swipe settles. A flick decides by its direction. A slow drag decides by how
  // far it went and which way the finger was last moving, so a patient swipe opens the
  // actions as surely as a quick one, and a small wobble still does not toggle the row.
  const finish=gesture=>{
   const offset=Math.min(0,gesture.dx-(gesture.open?gesture.width:0));
   const velocity=performance.now()-gesture.lastAt>80?0:gesture.velocity;
   const towardOpen=gesture.dir===-1;
   const ratio=gesture.open?0.65:(towardOpen?0.2:0.35);
   const open=velocity<-0.3?true:velocity>0.3?false:offset<-gesture.width*ratio;
   settle(gesture,open);
   setSwiped(current=>open?gesture.id:current===gesture.id?null:current);
  };
  return {
   click(event){
    const action=event.target?.closest?.('[data-action]')?.dataset.action;
    const id=action&&rowID(event.target);
    const trip=id&&find(id);
    if(!trip)return;
    if(suppress.current&&action==='open'){suppress.current=false;return;}
    // Tapping an open row closes it, as in iOS lists, instead of opening the activity.
    // Choosing activities to merge: a tap ticks or unticks the row; nothing opens.
    if(latest.current.selecting){if(action==='open'&&!trip.isShared&&canMergeTrip(trip)&&!latest.current.busy)latest.current.onToggleSelect(id);return;}
    if(action==='open'&&latest.current.swiped===id){setSwiped(null);return;}
    if(action==='open')latest.current.onOpen(trip);
    else if(trip.isShared)return;
    else if(action==='pin')latest.current.onBookmark(id);
    else if(action==='archive'&&latest.current.showArchived){setSwiped(null);latest.current.onRestore(id);}
    else if(action==='delete'&&!latest.current.busy&&deletionIDs(trip).length){setSwiped(null);latest.current.onDelete?.(trip);}
   },
   pointerDown(event){
    if(event.pointerType!=='touch'||!event.isPrimary||latest.current.selecting)return;
    const row=event.target?.closest?.('[data-trip-id]');
    const trip=row&&find(row.dataset.tripId);
    if(!trip||trip.isShared)return;
    // Touching another row closes the open one.
    if(latest.current.swiped&&latest.current.swiped!==trip.id)setSwiped(null);
    swipe.current={id:trip.id,row,pointerId:event.pointerId,x:event.clientX,y:event.clientY,dx:0,axis:null,
     open:latest.current.swiped===trip.id,width:actionWidth(row,trip.id),lastX:event.clientX,lastAt:performance.now(),velocity:0};
   },
   pointerMove(event){
    const gesture=swipe.current;
    if(!gesture||event.pointerId!==gesture.pointerId)return;
    const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
    if(!gesture.axis&&Math.max(Math.abs(dx),Math.abs(dy))>8)gesture.axis=Math.abs(dx)>Math.abs(dy)?'horizontal':'vertical';
    if(gesture.axis!=='horizontal')return;
    const now=performance.now(),dt=now-gesture.lastAt;
    if(dt>0)gesture.velocity=gesture.velocity*0.4+((event.clientX-gesture.lastX)/dt)*0.6;
    if(Math.abs(event.clientX-gesture.lastX)>=1)gesture.dir=event.clientX<gesture.lastX?-1:1;
    gesture.lastX=event.clientX;gesture.lastAt=now;gesture.dx=dx;
    gesture.row.dataset.swiping='true';
    const surface=gesture.row.querySelector('.trip-swipe-surface');
    if(surface)surface.style.transform=`translateX(${Math.max(-285,Math.min(0,dx-(gesture.open?gesture.width:0)))}px)`;
   },
   pointerUp(){
    const gesture=swipe.current;
    swipe.current=null;
    if(!gesture)return;
    if(gesture.axis!=='horizontal'){delete gesture.row.dataset.swiping;return;}
    suppress.current=true;
    setTimeout(()=>{suppress.current=false;},350);
    const trip=find(gesture.id);
    // In the Archived list a deliberate full-width swipe restores straight away. Anywhere
    // else it only reveals the actions, so the gesture can never delete by accident.
    if(latest.current.showArchived&&gesture.dx<-Math.min(window.innerWidth*0.55,260)&&trip){
     settle(gesture,false);setSwiped(null);
     latest.current.onRestore(trip.id);
     return;
    }
    finish(gesture);
   },
   pointerCancel(){
    // The browser can take a slow drag over as a scroll. A swipe already under way
    // settles where the finger left it instead of snapping back.
    const gesture=swipe.current;swipe.current=null;
    if(!gesture)return;
    if(gesture.axis==='horizontal'){suppress.current=true;setTimeout(()=>{suppress.current=false;},350);finish(gesture);}else settle(gesture,gesture.open);
   },
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

 const rows=useMemo(()=>list.map(trip=><TripRow key={trip.id} trip={trip} formatters={formatters} unit={unit} sort={sort} query={query} vehicles={vehicles} showArchived={showArchived} busy={busy} onEquipment={openEquipment} sharing={sharing?.[trip.id]||null} photos={photos} favourite={favouriteIDs.has(trip.id)} swiped={swiped===trip.id} selecting={selecting} picked={pickedIDs.has(trip.id)}/>),
  [list,formatters,unit,sort,query,vehicles,showArchived,busy,openEquipment,favouriteIDs,swiped,selecting,pickedIDs,sharing,photos]);

 return <>
  <div className="recent-activities trips-activity-list" onClick={handlers.click} onPointerDown={handlers.pointerDown} onPointerMove={handlers.pointerMove} onPointerUp={handlers.pointerUp} onPointerCancel={handlers.pointerCancel} onLostPointerCapture={handlers.pointerCancel}>
   {rows}
  </div>
  {more&&<><div className="trip-load-sentinel" ref={sentinel} aria-hidden="true"/><button type="button" className="secondary full trip-load-more" onClick={()=>setLimit(value=>Math.min(value+TRIP_PAGE_SIZE,journeys.length))}>Show more activities</button></>}

 </>;
}

