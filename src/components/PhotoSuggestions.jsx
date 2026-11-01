import {useMemo,useState} from 'react';
import PrivateImage from './PrivateImage.jsx';
import {
 SUGGESTION_LIMIT,assetKey,batchMessage,batchSummary,deselectSuggestions,fetchTruncated,
 groupSuggestions,planImport,selectSuggestions,selectedCount,selectionAfterBatch,
 suggestionConfidence,suggestionLabel,suggestionTime,visibleSuggestions
} from '../lib/photoSuggestions.js';

// Candidates are grouped by local day, selected by library identity, and only
// imported when the person asks for them. A batch reports what actually happened
// ("3 added · 1 failed"), keeps failed photos selected for a retry, and never
// offers a photo that is already kept with the activity.
export default function PhotoSuggestions({suggestions=[],existing=[],busy=false,limited=false,message='',onImport,onSkip,onClose}){
 const [selected,setSelected]=useState(()=>new Set());
 const [showSkipped,setShowSkipped]=useState(false);
 const [skips,setSkips]=useState({});
 const [imported,setImported]=useState(()=>new Set());
 const [results,setResults]=useState([]);
 const [working,setWorking]=useState(false);
 const [preview,setPreview]=useState(null);

 const items=useMemo(()=>suggestions
  .map(suggestion=>assetKey(suggestion) in skips?{...suggestion,skipped:skips[assetKey(suggestion)]}:suggestion)
  .filter(suggestion=>!imported.has(assetKey(suggestion))),[suggestions,skips,imported]);
 const visible=useMemo(()=>visibleSuggestions(items,{showSkipped}),[items,showSkipped]);
 const groups=useMemo(()=>groupSuggestions(items,{showSkipped}),[items,showSkipped]);
 const plan=useMemo(()=>planImport({suggestions:items,selected,existing}),[items,selected,existing]);
 // Every visible photo the activity already holds, shown as "Already added" and
 // never offered for import.
 const duplicates=useMemo(()=>planImport({suggestions:items,selected:null,existing}).duplicates,[items,existing]);
 const duplicateKeys=useMemo(()=>new Set(duplicates.map(entry=>entry.assetID)),[duplicates]);
 const chosen=selectedCount(selected,visible);
 const summary=batchSummary(results);
 const failures=summary.failures;

 async function runBatch(entries,duplicateEntries=[]){
  if((!entries.length&&!duplicateEntries.length)||working)return;
  setWorking(true);
  const outcome=duplicateEntries.map(entry=>({assetID:entry.assetID,status:'skipped'}));
  for(const entry of entries){
   let result={ok:false,message:'Not added.'};
   try{result=(await onImport?.(entry.assetID))||result;}catch(error){result={ok:false,message:error?.message||'Not added.'};}
   outcome.push(result.ok?{assetID:entry.assetID,status:'added'}:{assetID:entry.assetID,status:'failed',message:result.message});
  }
  setResults(outcome);
  // Imported photos leave the grid immediately; failures stay selected so the
  // retry acts on exactly what needs another attempt.
  setImported(current=>{const next=new Set(current);for(const result of outcome)if(result.status==='added')next.add(result.assetID);return next;});
  setSelected(current=>selectionAfterBatch(current,outcome));
  setWorking(false);
 }
 function importSelected(){void runBatch(plan.ready,plan.duplicates);}
 function retryFailed(){
  const entries=failures.map(failure=>({assetID:failure.assetID}));
  setResults(current=>current.filter(result=>result.status!=='failed'));
  void runBatch(entries);
 }
 async function skip(assetID,skipped){
  const ok=await onSkip?.(assetID,skipped);
  if(ok===false)return;
  setSkips(current=>({...current,[String(assetID)]:skipped}));
  if(skipped)setSelected(current=>{const next=new Set(current);next.delete(String(assetID));return next;});
 }
 function selectAll(){
  const eligible=visible.filter(suggestion=>!suggestion.skipped&&!duplicateKeys.has(assetKey(suggestion)));
  setSelected(current=>selectSuggestions(current,eligible));
 }
 function clearSelection(){setSelected(current=>deselectSuggestions(current,visible));}

 const status=working?'Adding photos…':batchMessage(summary);
 return <section className="photo-suggestions" aria-labelledby="photo-suggestions-heading">
  <div className="photo-suggestions-head">
   <h2 id="photo-suggestions-heading">Photo suggestions</h2>
   {onClose&&<button type="button" className="text-button" onClick={onClose}>Cancel</button>}
  </div>
  <p className="muted small-copy">{message||'Photos captured during this activity, from your own library.'} Only photos you add are copied to this activity; nothing is uploaded.</p>
  {limited&&<p className="muted small-copy">Your photo access is limited to selected photos, so this list may be incomplete.</p>}
  {fetchTruncated(suggestions.length)&&<p className="muted small-copy">Showing the first {SUGGESTION_LIMIT} photos captured during this activity.</p>}
  {!items.length?<p>No photos from your library were captured during this activity’s time range.</p>:<>
   <div className="suggestion-toolbar">
    <button type="button" className="secondary" disabled={busy||working||!visible.length} onClick={selectAll}>Select all</button>
    <button type="button" className="secondary" disabled={busy||working||!chosen} onClick={clearSelection}>Clear selection</button>
    <span className="muted small-copy" aria-live="polite">{chosen} of {visible.length} selected</span>
    <label className="checkbox-label"><input type="checkbox" checked={showSkipped} disabled={working} onChange={event=>setShowSkipped(event.target.checked)}/> Show skipped photos</label>
   </div>
   {duplicates.length>0&&<p className="muted small-copy">Already with this activity: {duplicates.length} photo{duplicates.length===1?'':'s'}.</p>}
   <div className="suggestion-days">
    {groups.map(group=><div key={group.day} className="suggestion-day" data-day={group.day}>
     <h3>{group.label}</h3>
     <ul className="suggestion-grid">
      {group.items.map(suggestion=>{
       const key=assetKey(suggestion);
       const isSelected=selected.has(key);
       const duplicate=duplicateKeys.has(key);
       const confidence=suggestionConfidence(suggestion);
       return <li key={key} className={suggestion.skipped?'skipped':undefined}>
        <label className="suggestion-tile">
         <input type="checkbox" checked={isSelected} disabled={busy||working||suggestion.skipped||duplicate} aria-label={suggestionLabel(suggestion,{selected:isSelected})} onChange={()=>setSelected(current=>{const next=new Set(current);if(next.has(key))next.delete(key);else next.add(key);return next;})}/>
         <PrivateImage src={suggestion.thumbnail} alt=""/>
        </label>
        <p className="suggestion-meta">{suggestionTime(suggestion)||'Time unknown'}{duplicate?' · Already added':''}</p>
        <p className="muted small-copy">{confidence.label}</p>
        <div className="suggestion-tile-actions">
         <button type="button" className="text-button" disabled={working} onClick={()=>setPreview(suggestion)} aria-label={`Preview suggested photo${suggestionTime(suggestion)?` from ${suggestionTime(suggestion)}`:''}`}>Preview</button>
         {suggestion.skipped
          ?<button type="button" className="text-button" disabled={busy||working} onClick={()=>void skip(key,false)}>Show again</button>
          :<button type="button" className="text-button" disabled={busy||working} onClick={()=>void skip(key,true)}>Skip</button>}
        </div>
       </li>;
      })}
     </ul>
    </div>)}
   </div>
   <div className="detail-actions suggestion-actions">
    <button type="button" className="primary" disabled={busy||working||!plan.ready.length} onClick={importSelected}>
     {working?'Adding photos…':plan.ready.length?`Add ${plan.ready.length} photo${plan.ready.length===1?'':'s'}`:'Select photos to add'}
    </button>
    {failures.length>0&&<button type="button" className="secondary" disabled={busy||working} onClick={retryFailed}>Retry {failures.length} failed</button>}
   </div>
  </>}
  {preview&&<div className="photo-preview" role="dialog" aria-modal="true" aria-label="Photo preview">
   <PrivateImage src={preview.thumbnail} alt=""/>
   <p className="muted small-copy">{suggestionTime(preview)||'Time unknown'} · {suggestionConfidence(preview).label}</p>
   <div className="detail-actions">
    <button type="button" className="secondary" disabled={working} onClick={()=>setSelected(current=>{const next=new Set(current);const key=assetKey(preview);if(next.has(key))next.delete(key);else next.add(key);return next;})}>{selected.has(assetKey(preview))?'Deselect photo':'Select photo'}</button>
    <button type="button" className="primary" onClick={()=>setPreview(null)}>Done</button>
   </div>
  </div>}
  {status&&<p role="status" className="suggestion-status">{status}</p>}
  {failures.length>0&&<ul className="suggestion-failures">{failures.map(failure=><li key={failure.assetID}>{failure.message}</li>)}</ul>}
 </section>;
}
