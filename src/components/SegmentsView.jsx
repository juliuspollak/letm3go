import {useEffect,useMemo,useState} from 'react';
import {ChevronRight,Flag,LocateFixed,RefreshCw,Search} from 'lucide-react';
import ActivityIcon from './ActivityIcon.jsx';
import {activityLabel} from '../lib/activityNames.js';
import {distanceText} from '../lib/distanceUnits.js';
import {SEGMENT_ACTIVITIES} from '../lib/namedSegments.js';
import {SEGMENT_PAGE,SEGMENT_SCOPES,areaAround,listSegments} from '../lib/segmentsApi.js';
import {SEGMENT_SYNC_LABELS,localSegmentStates} from '../lib/segmentSyncState.js';

// Activities → Segments: the one community segment library. All, Nearby and Mine,
// search and activity type. It loads only while shown; switching back to
// Activities keeps nothing running. Creating a segment stays in an activity
// (Create Segment); this view finds, opens and manages them.
export default function SegmentsView({owner,journeys,receipts,position=null,onLocate=null,unit='km',onOpen,onOpenActivity,onSync=null,version=0}){
 const [scope,setScope]=useState('all');
 const [query,setQuery]=useState('');
 const [activity,setActivity]=useState('');
 const [result,setResult]=useState({key:'',rows:[],more:false,error:''});
 const [pages,setPages]=useState(1);
 const [typed,setTyped]=useState('');
 const [attempt,setAttempt]=useState(0);
 // Typing settles before a search is sent.
 useEffect(()=>{const timer=setTimeout(()=>setQuery(typed),300);return()=>clearTimeout(timer);},[typed]);
 const area=scope==='nearby'?areaAround(position):null;
 const waitingForPlace=scope==='nearby'&&!area;
 // `version` changes when a segment is edited or deleted, so the list reloads.
 const key=JSON.stringify([scope,query.trim(),activity,area&&[area.minLat.toFixed(2),area.minLon.toFixed(2)],attempt,version]);
 // Each page continues from the rows already shown (offset), so the server's
 // 100-row request limit never caps how far the list goes.
 useEffect(()=>{
  if(waitingForPlace)return undefined;
  let alive=true;
  const offset=pages>1&&result.key===key?result.rows.length:0;
  listSegments({scope,query,activity,area,offset,limit:SEGMENT_PAGE+1})
   .then(rows=>{if(alive)setResult(previous=>({key,rows:[...(offset&&previous.key===key?previous.rows:[]),...rows.slice(0,SEGMENT_PAGE)],more:rows.length>SEGMENT_PAGE,error:'',pages}));})
   .catch(error=>{if(alive)setResult(previous=>offset?{...previous,more:true,error:error.message,pages}:{key,rows:[],more:false,error:error.message,pages});});
  return()=>{alive=false;};
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` and `pages` capture every input
 },[key,pages,waitingForPlace]);
 const loading=!waitingForPlace&&(result.key!==key||result.pages!==pages);
 // Mine also lists segments made here that the server does not have yet.
 const local=useMemo(()=>scope==='mine'?localSegmentStates(journeys,receipts,owner):[],[scope,journeys,receipts,owner]);
 // Rows from another scope never show under Nearby's location prompt.
 const rows=waitingForPlace||result.key!==key&&result.pages===1?[]:result.rows;
 const published=new Set(rows.map(row=>row.id));
 const unpublished=local.filter(row=>row.state!=='published'&&!published.has(row.id));
 const choose=next=>{setScope(next);setPages(1);};
 return <section className="segments-view" aria-label="Community segments">
  <div className="feedback-sections segment-scopes" role="group" aria-label="Which segments">
   {SEGMENT_SCOPES.map(([id,label])=><button key={id} type="button" className={scope===id?'selected':''} aria-pressed={scope===id} onClick={()=>choose(id)}>{label}</button>)}
  </div>
  <div className="segment-filters">
   <label className="segment-search"><Search size={16} aria-hidden="true"/><span className="sr-only">Search segments</span>
    <input type="search" value={typed} placeholder="Search segments" onChange={event=>{setTyped(event.target.value);setPages(1);}}/></label>
   <label><span className="sr-only">Activity type</span>
    <select value={activity} onChange={event=>{setActivity(event.target.value);setPages(1);}}>
     <option value="">All activities</option>{SEGMENT_ACTIVITIES.map(code=><option key={code} value={code}>{activityLabel(code)}</option>)}
    </select></label>
  </div>
  {waitingForPlace&&<div className="empty"><LocateFixed/><h3>Where are you?</h3><p>Nearby needs your location.</p>{onLocate&&<button type="button" className="secondary" onClick={onLocate}>Use my location</button>}</div>}
  {unpublished.length>0&&<ul className="segment-list segment-local" aria-label="Made on this iPhone">
   {unpublished.map(row=><li key={row.id}><button type="button" className="segment-row" onClick={()=>onOpenActivity?.(row.activityID)}>
    <span className="recent-activity-icon"><ActivityIcon activity={activityLabel(row.activity)} size={18}/></span>
    <span className="segment-row-info"><strong>{row.name}</strong><small className={`segment-sync segment-sync--${row.state}`}>{SEGMENT_SYNC_LABELS[row.state]}{row.reason&&row.state==='refused'?` ${row.reason}`:''}</small></span>
    <ChevronRight size={16} aria-hidden="true"/></button></li>)}
   {onSync&&unpublished.some(row=>row.state!=='refused')&&<li><button type="button" className="secondary full" onClick={onSync}><RefreshCw size={16}/> Retry now</button></li>}
  </ul>}
  {result.error&&!loading&&<p role="alert" className="notice">{result.error} <button type="button" className="text-button" onClick={()=>setAttempt(n=>n+1)}>Retry</button></p>}
  {loading&&!rows.length&&<p role="status" className="muted">Loading segments…</p>}
  {!loading&&!waitingForPlace&&!result.error&&!rows.length&&!unpublished.length&&<div className="empty"><Flag/><h3>{scope==='mine'?'No segments yet':'No segments found'}</h3>
   <p>{scope==='mine'?'Open a ride, walk or run and choose Create Segment.':'Try another search, activity or area.'}</p></div>}
  {rows.length>0&&<ul className="segment-list" aria-busy={loading}>
   {rows.map(row=><li key={row.id}><button type="button" className="segment-row" onClick={()=>onOpen(row.id)} aria-label={`Open segment ${row.name}`}>
    <span className="recent-activity-icon"><ActivityIcon activity={activityLabel(row.activity||'Other')} size={18}/></span>
    <span className="segment-row-info"><strong>{row.name}</strong>
     <small>{row.activity?activityLabel(row.activity):'Any activity'} · {distanceText(row.distance_meters/1000,unit)} · {row.mine?'Yours':`by ${row.creator_name}`}</small>
     {Number(row.efforts)>0&&<small>{row.efforts} effort{Number(row.efforts)===1?'':'s'}</small>}
     {row.mine&&row.status!=='approved'&&<small className="segment-sync segment-sync--refused">Not public ({row.status.replace('_',' ')})</small>}</span>
    <ChevronRight size={16} aria-hidden="true"/></button></li>)}
  </ul>}
  {result.more&&!waitingForPlace&&<button type="button" className="secondary full" disabled={loading} onClick={()=>setPages(n=>n+1)}>Show more segments</button>}
 </section>;
}
