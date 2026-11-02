import {useEffect,useMemo,useRef,useState} from 'react';
import PrivateImage from './PrivateImage.jsx';
import {
 assetKey,batchMessage,batchSummary,deselectSuggestions,failureRetryable,groupSuggestions,
 markSkipped,mergeBatchResults,photoCapacity,planImport,reconcileSelection,selectSuggestions,selectedCount,
 selectionAfterBatch,suggestionConfidence,suggestionLabel,suggestionTime,toggleSelected,visibleSuggestions
} from '../lib/photoSuggestions.js';

// Candidates are grouped by the activity's day, selected by library identity, and
// only imported when the person asks for them. A batch reports what actually
// happened ("3 added · 1 cancelled"), keeps failed photos selected for a retry,
// can be cancelled between photos without losing what already imported, and never
// offers a photo that is already kept with the activity.
export default function PhotoSuggestions({
 suggestions=[],existing=[],busy=false,limited=false,message='',hasMore=false,total=null,loadingMore=false,timeZone,
 onImport,onSkip,onClose,onLoadMore
}){
 const [selected,setSelected]=useState(()=>new Set());
 const [showSkipped,setShowSkipped]=useState(false);
 const [skips,setSkips]=useState({});
 const [imported,setImported]=useState(()=>new Set());
 const [results,setResults]=useState([]);
 const [working,setWorking]=useState(false);
 const [cancelling,setCancelling]=useState(false);
 const workingRef=useRef(false);

 const [progress,setProgress]=useState({done:0,total:0});
 const [preview,setPreview]=useState(null);
 const previewTrigger=useRef(null);
 const previewDialog=useRef(null);
 const alive=useRef(true);
 const runToken=useRef(null);
 // Re-arm on every effect setup (StrictMode performs setup → cleanup → setup)
 // so an in-flight batch in development is not mistaken for an unmounted one.
 useEffect(()=>{alive.current=true;return ()=>{alive.current=false;if(runToken.current)runToken.current.cancelled=true;};},[]);

 const items=useMemo(()=>{
  let list=suggestions.map(suggestion=>({...suggestion}));
  for(const [key,skipped] of Object.entries(skips))list=markSkipped(list,key,skipped);
  return list.filter(suggestion=>!imported.has(assetKey(suggestion)));
 },[suggestions,skips,imported]);
 const visible=useMemo(()=>visibleSuggestions(items,{showSkipped}),[items,showSkipped]);
 const groups=useMemo(()=>groupSuggestions(items,{showSkipped,timeZone}),[items,showSkipped,timeZone]);
 // A refresh can remove, skip or import a photo while its key is still in the
 // local set. Reconcile during render so the count and Add Selected describe only
 // candidates that can still be imported; if a photo comes back (undo skip or a
 // later page) the selection the person already made is still there.
 const chosenSelection=useMemo(()=>reconcileSelection(selected,items,{existing}),[selected,items,existing]);
 const plan=useMemo(()=>planImport({suggestions:items,selected:chosenSelection,existing}),[items,chosenSelection,existing]);
 // Every visible photo the activity already holds, shown as "Already added" and
 // never offered for import.
 const duplicates=useMemo(()=>planImport({suggestions:items,selected:null,existing}).duplicates,[items,existing]);
 const duplicateKeys=useMemo(()=>new Set(duplicates.map(entry=>entry.assetID)),[duplicates]);
 const capacity=useMemo(()=>photoCapacity(existing),[existing]);
 const chosen=selectedCount(chosenSelection,visible);
 const summary=batchSummary(results);
 const failures=summary.failures;
 const retryable=failures.filter(failure=>failureRetryable(failure.message));
 const overCapacity=plan.ready.length>capacity.remaining;
 const canAdd=!capacity.full&&!overCapacity;

 async function runBatch(entries,duplicateEntries=[],{merge=false}={}){
  // The state update that disables the button is asynchronous. A ref closes the
  // double-click gap so one photo can never be sent to the native side twice.
  if((!entries.length&&!duplicateEntries.length)||working||workingRef.current)return;
  workingRef.current=true;
  const token={cancelled:false};runToken.current=token;
  setWorking(true);setCancelling(false);setProgress({done:0,total:entries.length});
  const outcome=duplicateEntries.map(entry=>({assetID:entry.assetID,status:'skipped'}));
  let done=0,blocked=false;
  for(const entry of entries){
   // Cancelling stops *between* photos: an import already sent to the native side
   // finishes and its result is reported, so a cancelled batch never claims a
   // photo was not added when it was. A non-retryable rejection (an account
   // switch, a revoked library permission or the per-activity cap) stops the rest
   // of the batch instead of firing doomed imports for every remaining photo.
   if(token.cancelled||blocked||!alive.current){
    outcome.push({assetID:entry.assetID,status:'cancelled'});
    continue;
   }
   let result={ok:false,message:'Not added.'};
   try{result=(await onImport?.(entry.assetID))||result;}catch(error){result={ok:false,message:error?.message||'Not added.'};}
   outcome.push(result.ok?{assetID:entry.assetID,status:'added'}:{assetID:entry.assetID,status:'failed',message:result.message});
   done+=1;
   if(!result.ok&&!failureRetryable(result.message))blocked=true;
   if(alive.current)setProgress({done,total:entries.length});
  }
  runToken.current=null;
  workingRef.current=false;
  if(!alive.current)return;
  setResults(current=>merge?mergeBatchResults(current,outcome):outcome);
  // Imported photos leave the grid immediately; failures stay selected so the
  // retry acts on exactly what needs another attempt.
  setImported(current=>{const next=new Set(current);for(const result of outcome)if(result.status==='added')next.add(result.assetID);return next;});
  setSelected(current=>selectionAfterBatch(current,outcome));
  setWorking(false);setCancelling(false);
 }
 function importSelected(){void runBatch(plan.ready,plan.duplicates);}
 function retryFailed(){
  const entries=retryable.map(failure=>({assetID:failure.assetID}));
  if(!entries.length)return;
  // Keep the earlier successes visible; only the retried outcomes change.
  void runBatch(entries,[],{merge:true});
 }
 // Cancel is one control with one meaning: it stops a running batch, and closes
 // the sheet when nothing is running. The native import in flight always lands.
 function cancel(){
  if(working){if(runToken.current)runToken.current.cancelled=true;setCancelling(true);return;}
  onClose?.();
 }
 async function skip(assetID,skipped){
  const ok=await onSkip?.(assetID,skipped);
  if(ok===false||!alive.current)return;
  setSkips(current=>({...current,[String(assetID)]:skipped}));
  if(skipped)setSelected(current=>{const next=new Set(current);next.delete(String(assetID));return next;});
 }
 function selectAll(){
  const eligible=visible.filter(suggestion=>!suggestion.skipped&&!duplicateKeys.has(assetKey(suggestion)));
  setSelected(current=>selectSuggestions(current,eligible));
 }
 function clearSelection(){setSelected(current=>deselectSuggestions(current,visible));}
 function toggleDay(groupItems){
  const eligible=groupItems.filter(suggestion=>!suggestion.skipped&&!duplicateKeys.has(assetKey(suggestion)));
  const allChosen=eligible.length>0&&eligible.every(suggestion=>chosenSelection.has(assetKey(suggestion)));
  setSelected(current=>allChosen?deselectSuggestions(current,eligible):selectSuggestions(current,eligible));
 }

 const pageNote=hasMore
  ?`Showing ${items.length}${total?` of ${total}`:''} photos captured during this activity. Load more to see the rest.`
  :total!=null&&total>items.length?`Showing ${items.length} of ${total} photos captured during this activity.`:'';
 const status=working?(cancelling?'Stopping after this photo…':`Adding ${Math.min(progress.done+1,Math.max(progress.total,1))} of ${progress.total}…`):batchMessage(summary);
 // An empty grid has several very different causes. Do not tell someone their
 // library had no photos when the page simply contains only photos already
 // added, or when more pages still exist. That false "none exist" copy made a
 // completed import look like the activity had nothing to offer.
 const emptyMessage=!suggestions.length
  ?(hasMore?'No photos in this first page. Load more to continue.':'No photos from your library were captured during this activity’s time range.')
  :'All shown photos added.';
 // The preview can outlive a refresh or a skip. Resolve it against the current
 // list so it never offers a photo that has since been added or skipped; an
 // imported photo leaves the list and its preview closes with it.
 const previewItem=preview?items.find(item=>assetKey(item)===assetKey(preview))||null:null;
 const previewBlocked=previewItem?.skipped===true||(previewItem?duplicateKeys.has(assetKey(previewItem)):false);
 useEffect(()=>{
  if(previewItem){
   const close=previewDialog.current?.querySelector('[data-dialog-close]');
   if(close)close.focus();
  }else if(previewTrigger.current){
   previewTrigger.current.focus();
   previewTrigger.current=null;
  }
 },[previewItem]);
 function handlePreviewKeyDown(event){
  if(event.key==='Escape'){event.preventDefault();setPreview(null);return;}
  if(event.key!=='Tab')return;
  const dialog=event.currentTarget;
  const focusables=dialog.querySelectorAll('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if(!focusables.length)return;
  const first=focusables[0],last=focusables[focusables.length-1];
  if(event.shiftKey){if(document.activeElement===first){event.preventDefault();last.focus();}}
  else if(document.activeElement===last){event.preventDefault();first.focus();}
 }
 return <section className="photo-suggestions" aria-labelledby="photo-suggestions-heading">
  <div className="photo-suggestions-head">
   <h2 id="photo-suggestions-heading">Photo suggestions</h2>
  </div>
  <p className="muted small-copy">{message||'Photos captured during this activity, from your own library.'} Only photos you add are copied to this activity; nothing is uploaded.</p>
  {limited&&<p className="muted small-copy">Your photo access is limited to selected photos, so this list may be incomplete.</p>}
  {pageNote&&<p className="muted small-copy">{pageNote}</p>}
  {capacity.full&&<p className="muted small-copy" role="status">This activity already has the maximum of {capacity.limit} photos.</p>}
  {!capacity.full&&overCapacity&&<p className="muted small-copy" role="alert">{plan.ready.length} photos are selected but only {capacity.remaining} more fit in this activity ({capacity.limit} photos maximum). Deselect {plan.ready.length-capacity.remaining} to add the rest.</p>}
  {!items.length?<p>{emptyMessage}</p>:<>
   <div className="suggestion-toolbar">
    <button type="button" className="secondary" disabled={busy||working||!visible.length} onClick={selectAll}>Select all</button>
    <button type="button" className="secondary" disabled={busy||working||!chosen} onClick={clearSelection}>Clear selection</button>
    <span className="muted small-copy" aria-live="polite">{chosen} of {visible.length} selected</span>
    <label className="checkbox-label"><input type="checkbox" checked={showSkipped} disabled={working} onChange={event=>setShowSkipped(event.target.checked)}/> Show skipped photos</label>
   </div>
   {duplicates.length>0&&<p className="muted small-copy">Already with this activity: {duplicates.length} photo{duplicates.length===1?'':'s'}.</p>}
   <div className="suggestion-days">
    {groups.map(group=>{
     const eligible=group.items.filter(suggestion=>!suggestion.skipped&&!duplicateKeys.has(assetKey(suggestion)));
     const allChosen=eligible.length>0&&eligible.every(suggestion=>chosenSelection.has(assetKey(suggestion)));
     return <div key={group.day} className="suggestion-day" data-day={group.day}>
      <div className="suggestion-day-head">
       <h3>{group.label}</h3>
       {eligible.length>0&&<button type="button" className="text-button" disabled={working} onClick={()=>toggleDay(group.items)}>{allChosen?'Clear day':'Select day'}</button>}
      </div>
      <ul className="suggestion-grid">
       {group.items.map(suggestion=>{
        const key=assetKey(suggestion);
        const isSelected=chosenSelection.has(key);
        const duplicate=duplicateKeys.has(key);
        const locallyAvailable=suggestion.localAvailable!==false&&Boolean(suggestion.thumbnail);
        const confidence=suggestionConfidence(suggestion);
        const time=suggestionTime(suggestion,{timeZone});
        return <li key={key} className={suggestion.skipped?'skipped':undefined}>
         <label className="suggestion-tile">
          <input type="checkbox" checked={isSelected} disabled={busy||working||suggestion.skipped||duplicate} aria-label={suggestionLabel(suggestion,{selected:isSelected,timeZone})} onChange={()=>setSelected(current=>toggleSelected(current,key))}/>
          {locallyAvailable?<PrivateImage src={suggestion.thumbnail} alt="" loading="lazy"/>:<span className="suggestion-placeholder">In iCloud</span>}
         </label>
         <p className="suggestion-meta">{time||'Time unknown'}{duplicate?' · Already added':''}</p>
         <p className="muted small-copy">{confidence.label}</p>
         {!locallyAvailable&&!duplicate&&<p className="muted small-copy">Not downloaded. Download it in Photos, then retry.</p>}
         <div className="suggestion-tile-actions">
          <button type="button" className="text-button" disabled={working} onClick={event=>{previewTrigger.current=event.currentTarget;setPreview(suggestion);}} aria-label={`Preview suggested photo${time?` from ${time}`:''}`}>Preview</button>
          {suggestion.skipped
           ?<button type="button" className="text-button" disabled={busy||working} aria-label={`Show suggested photo from ${time||'unknown time'} again`} onClick={()=>void skip(key,false)}>Show again</button>
           :<button type="button" className="text-button" disabled={busy||working} aria-label={`Skip suggested photo from ${time||'unknown time'}`} onClick={()=>void skip(key,true)}>Skip</button>}
         </div>
        </li>;
       })}
      </ul>
     </div>;
    })}
   </div>
  </>}
  {/* Continuation and Cancel belong to the sheet, not to the grid: a page that
      rendered empty (or whose photos were all just imported) still has more
      candidates and must still be leavable. */}
  {hasMore&&onLoadMore&&<div className="suggestion-more">
   <button type="button" className="secondary" disabled={working||loadingMore} onClick={()=>onLoadMore()}>{loadingMore?'Loading more photos…':'Load more photos'}</button>
  </div>}
  <div className="detail-actions suggestion-actions">
   <button type="button" className="primary" disabled={busy||working||!plan.ready.length||!canAdd} onClick={importSelected}>
    {working?`Adding ${Math.min(progress.done+1,Math.max(progress.total,1))} of ${progress.total}…`:`Add Selected (${plan.ready.length})`}
   </button>
   {(onClose||working)&&<button type="button" className="secondary" onClick={cancel} disabled={cancelling}>{working?'Cancel import':'Cancel'}</button>}
   {retryable.length>0&&<button type="button" className="secondary" disabled={busy||working} onClick={retryFailed}>Retry {retryable.length} failed</button>}
  </div>
  {previewItem&&<div className="photo-preview" role="dialog" aria-modal="true" aria-label="Photo preview" ref={previewDialog} onKeyDown={handlePreviewKeyDown}>
   {previewItem.localAvailable===false||!previewItem.thumbnail
    ?<p className="muted small-copy">This photo is in iCloud and has not been downloaded. Download it in Photos to add it to this activity.</p>
    :<PrivateImage src={previewItem.thumbnail} alt=""/>}
   <p className="muted small-copy">{suggestionTime(previewItem,{timeZone})||'Time unknown'} · {suggestionConfidence(previewItem).label}</p>
   <div className="detail-actions">
    <button type="button" className="secondary" disabled={working||previewBlocked} onClick={()=>setSelected(current=>toggleSelected(current,assetKey(previewItem)))}>
     {previewItem.skipped?'Skipped photo':previewBlocked?'Already added':chosenSelection.has(assetKey(previewItem))?'Deselect photo':'Select photo'}
    </button>
    <button type="button" className="primary" data-dialog-close onClick={()=>setPreview(null)}>Done</button>
   </div>
  </div>}
  {status&&<p role="status" className="suggestion-status">{status}</p>}
  {failures.length>0&&<ul className="suggestion-failures">{failures.map(failure=>{
   const suggestion=items.find(item=>assetKey(item)===failure.assetID);
   return <li key={failure.assetID}>{suggestionTime(suggestion||{},{timeZone})||'Time unknown'} · {failure.message}{failureRetryable(failure.message)?'':' This photo cannot be retried.'}</li>;
  })}</ul>}
 </section>;
}
