// Photo suggestions are candidate photographs that already sit in the person's
// own library. Nothing here uploads, copies or mutates a photo: this module only
// decides which candidates are selected, in what order they are imported, and
// what happened to each one afterwards. Keeping it pure means the same rules are
// used by the sheet, the retry action and the regression tests.
//
// The native suggestion fetch is paged (perPage in
// ios/App/App/PhotoSuggestions.swift). This constant must match it: the sheet
// asks for the next page while the library says there is more, instead of
// implying the library was searched exhaustively.
export const SUGGESTION_PAGE_SIZE=30;
export const SUGGESTION_LIMIT=SUGGESTION_PAGE_SIZE;
// The native photo store keeps at most 50 photos per activity
// (the `details.photos.count < 50` guard in ios/App/App/ActivityServices.swift).
export const PHOTO_LIMIT=50;
// A capture time close to a kept photo is only a *possible* duplicate: two burst
// shots a second apart are distinct photos and must both be importable.
export const DUPLICATE_WINDOW_SECONDS=2;

const finite=Number.isFinite;
export const assetKey=suggestion=>String(suggestion?.assetID??'');
const captureSeconds=suggestion=>finite(suggestion?.captureTime)?suggestion.captureTime:null;

// True only for an exact library identity that the activity already keeps.
// Capture time is never used to block an import: Photos re-encodes metadata and
// burst shots share a second, so a near-time match would hide real photos while
// still being unable to prove identity.
export function isDuplicate(suggestion,existing=[]){
 const key=assetKey(suggestion);
 if(!key)return false;
 return (existing||[]).some(photo=>photo&&photo.assetID&&String(photo.assetID)===key);
}
// Non-blocking hint for the UI: this candidate looks like it was taken at the
// same moment as a kept photo, but it is not the same asset and stays selectable.
export function sameCaptureMoment(suggestion,existing=[]){
 const time=captureSeconds(suggestion);
 if(time==null)return false;
 return (existing||[]).some(photo=>{
  const kept=finite(photo?.captureTime)?photo.captureTime:null;
  return kept!=null&&Math.abs(kept-time)<=DUPLICATE_WINDOW_SECONDS;
 });
}
// How many more photos this activity can hold. The picker and a suggestion batch
// both use it so a batch is never planned past the native cap.
export function photoCapacity(existing=[],limit=PHOTO_LIMIT){
 const used=(existing||[]).filter(Boolean).length;
 return {limit,used,remaining:Math.max(0,limit-used),full:used>=limit};
}
// A rejected import that cannot succeed by trying again: the per-activity cap or
// an account switch. Everything else (a photo not downloaded locally) can retry.
export function failureRetryable(message){
 const text=String(message||'');
 if(/up to 50 photos/i.test(text))return false;
 if(/limit of 50/i.test(text))return false;
 if(/account changed/i.test(text))return false;
 if(/not granted|permission/i.test(text))return false;
 return true;
}

// A paged search appends to the list the person is already looking at. A row can
// repeat across pages while Photos is still indexing, so merging de-duplicates by
// asset instead of showing the same photo twice.
export function mergeSuggestionPages(current=[],page=[]){
 const next=[...(current||[])].filter(suggestion=>suggestion&&assetKey(suggestion));
 const seen=new Set(next.map(assetKey));
 for(const suggestion of page||[]){
  if(!suggestion||!assetKey(suggestion)||seen.has(assetKey(suggestion)))continue;
  seen.add(assetKey(suggestion));next.push(suggestion);
 }
 return next;
}
// Offset for the next page: the number of distinct candidates already held, so a
// duplicated row from Photos cannot make the next page skip an asset.
export function nextSuggestionOffset(suggestions=[]){return new Set((suggestions||[]).map(assetKey)).size;}

// Human explanation of why this candidate belongs to the activity. A suggestion
// only exists because the capture time fell inside the activity window; the
// position is only real GPS when the asset carries a location.
export function suggestionConfidence(suggestion){
 if(suggestion?.hasLocation===true)return {id:'gps',label:'Date match · photo GPS',detail:'Taken during this activity. The photo has its own GPS; proximity to the route has not been verified.'};
 if(suggestion?.hasLocation===false)return {id:'time',label:'Date match only',detail:'Only the time matches, so any map position is inferred from the route.'};
 return {id:'unknown',label:'Date match',detail:'Captured during this activity. Location comes from the photo if it has one.'};
}

function zonedParts(seconds,timeZone){
 const date=new Date(seconds*1000);
 const local=()=>({year:date.getFullYear(),month:date.getMonth()+1,date:date.getDate(),hour:date.getHours(),minute:date.getMinutes()});
 if(!timeZone)return local();
 let format;
 try{format=new Intl.DateTimeFormat('en-AU',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});}
 catch{return local();}
 const parts={};
 for(const part of format.formatToParts(date))if(part.type!=='literal')parts[part.type]=Number(part.value);
 if(!Number.isFinite(parts.year)||!Number.isFinite(parts.month)||!Number.isFinite(parts.day))return local();
 return {year:parts.year,month:parts.month,date:parts.day,hour:parts.hour%24,minute:parts.minute};
}

// The activity's own timezone wins over the device's: a photo taken on a trip is
// described in the time it was taken there, not where the person is reading it.
// An unknown or invalid zone falls back to device time instead of throwing.
export function suggestionTime(suggestion,{timeZone}={}){
 const seconds=captureSeconds(suggestion);
 if(seconds==null)return '';
 const date=new Date(seconds*1000);
 if(timeZone){
  try{return date.toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit',timeZone});}
  catch{/* fall through to device time */}
 }
 return date.toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'});
}

// Calendar day in the activity's timezone, so a photo taken just after midnight
// is not grouped with the previous day because of a UTC or device offset.
export function suggestionDay(suggestion,{timeZone}={}){
 const seconds=captureSeconds(suggestion);
 if(seconds==null)return 'unknown';
 const parts=zonedParts(seconds,timeZone);
 return `${parts.year}-${String(parts.month).padStart(2,'0')}-${String(parts.date).padStart(2,'0')}`;
}

export function dayLabel(day){
 if(day==='unknown')return 'Date unknown';
 const [year,month,date]=day.split('-').map(Number);
 if(!Number.isFinite(year)||!Number.isFinite(month)||!Number.isFinite(date))return 'Date unknown';
 // The day is already a calendar day in the activity's timezone, so format it in
 // UTC: a device offset must not shift the label back a day.
 return new Date(Date.UTC(year,month-1,date,12)).toLocaleDateString('en-AU',{weekday:'short',day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
}

// Ordered suggestions for the grid: never-skipped first (in capture order),
// skipped ones only when the person asks to revisit them. A photo with no
// capture time cannot be placed in the timeline, so it goes last instead of
// pretending it was taken at the epoch.
export function visibleSuggestions(suggestions=[],{showSkipped=false}={}){
 return (suggestions||[])
  .filter(suggestion=>suggestion&&assetKey(suggestion))
  .filter(suggestion=>showSkipped||suggestion.skipped!==true)
  .slice()
  .sort((a,b)=>{
   const left=captureSeconds(a),right=captureSeconds(b);
   if(left==null&&right==null)return assetKey(a).localeCompare(assetKey(b));
   if(left==null)return 1;
   if(right==null)return -1;
   return left-right||assetKey(a).localeCompare(assetKey(b));
  });
}

export function groupSuggestions(suggestions,{showSkipped=false,timeZone}={}){
 const groups=[];
 for(const suggestion of visibleSuggestions(suggestions,{showSkipped})){
  const day=suggestionDay(suggestion,{timeZone});
  const group=groups.at(-1);
  if(group?.day===day)group.items.push(suggestion);
  else groups.push({day,label:dayLabel(day),items:[suggestion]});
 }
 // Dated days in calendar order, then the photos whose date is unknown.
 return groups.sort((a,b)=>a.day==='unknown'?1:b.day==='unknown'?-1:0);
}

// Selection is keyed by asset identifier, so re-fetching suggestions (same
// assets, new thumbnails) keeps a selection instead of silently clearing it.
export function toggleSelected(selected,assetID){
 const next=new Set(selected||[]);
 const key=String(assetID);
 if(next.has(key))next.delete(key);else next.add(key);
 return next;
}
export function selectSuggestions(selected,suggestions){
 const next=new Set(selected||[]);
 for(const suggestion of suggestions||[])if(suggestion&&!suggestion.skipped)next.add(assetKey(suggestion));
 return next;
}
export function deselectSuggestions(selected,suggestions){
 const next=new Set(selected||[]);
 for(const suggestion of suggestions||[])next.delete(assetKey(suggestion));
 return next;
}
// A selection that survives a refresh is filtered to suggestions that are still
// eligible, so a photo that became a duplicate or was skipped is never imported
// by a stale selection.
export function reconcileSelection(selected,suggestions=[],{existing=[]}={}){
 const eligible=new Set();
 for(const suggestion of suggestions||[]){
  if(!suggestion||suggestion.skipped)continue;
  if(isDuplicate(suggestion,existing))continue;
  eligible.add(assetKey(suggestion));
 }
 return new Set([...(selected||[])].filter(key=>eligible.has(key)));
}
export function selectedCount(selected,suggestions=[]){
 const keys=new Set((suggestions||[]).map(assetKey));
 return [...(selected||[])].filter(key=>keys.has(key)).length;
}

// Split a selection into what can be imported now and what is already with the
// activity. Selection order is the library order shown to the person.
export function planImport({suggestions=[],selected=null,existing=[]}={}){
 const ready=[],duplicates=[];
 for(const suggestion of visibleSuggestions(suggestions,{showSkipped:true})){
  const key=assetKey(suggestion);
  if(selected&&!selected.has(key))continue;
  if(suggestion.skipped)continue;
  if(isDuplicate(suggestion,existing))duplicates.push({assetID:key,suggestion});
  else ready.push({assetID:key,suggestion});
 }
 return {ready,duplicates};
}

// A retry reports the whole batch, not only the assets that were retried. The
// earlier successes are still real and must not disappear from the status line
// (which would make a completed retry look as if those photos were never added).
// Results are keyed by asset identity, with the retried outcome replacing the old
// one in place so the order stays stable.
export function mergeBatchResults(previous=[],next=[]){
 const merged=[];
 const positions=new Map();
 for(const result of previous||[]){
  if(!result||result.assetID==null)continue;
  positions.set(String(result.assetID),merged.length);
  merged.push(result);
 }
 for(const result of next||[]){
  if(!result||result.assetID==null)continue;
  const key=String(result.assetID);
  if(positions.has(key))merged[positions.get(key)]=result;
  else{positions.set(key,merged.length);merged.push(result);}
 }
 return merged;
}

// Results are collected per asset as the import runs, so a partial failure can
// be reported honestly and retried without duplicating the photos that worked.
// A cancelled batch keeps the results it already produced: imports that finished
// are real and must never be re-offered as if nothing happened.
export function batchSummary(results=[]){
 const added=[],skipped=[],cancelled=[],failures=[];
 for(const result of results||[]){
  if(result.status==='added')added.push(result.assetID);
  else if(result.status==='skipped')skipped.push(result.assetID);
  else if(result.status==='cancelled')cancelled.push(result.assetID);
  else failures.push({assetID:result.assetID,message:result.message||'Could not be added.'});
 }
 return {total:(results||[]).length,added:added.length,skipped:skipped.length,cancelled:cancelled.length,failed:failures.length,failures,addedIDs:added,skippedIDs:skipped,cancelledIDs:cancelled};
}
export function batchMessage(summary){
 if(!summary||!summary.total)return '';
 const parts=[`${summary.added} added`];
 if(summary.cancelled)parts.push(`${summary.cancelled} cancelled`);
 if(summary.failed)parts.push(`${summary.failed} failed`);
 if(summary.skipped)parts.push(`${summary.skipped} already with this activity`);
 return parts.join(' · ');
}
// After a batch, successes and duplicates leave the selection; failures stay
// selected so the retry button acts on exactly the photos that need another go.
export function selectionAfterBatch(selected,results=[]){
 const next=new Set(selected||[]);
 for(const result of results||[]){
  if(result.status==='failed')continue;
  next.delete(String(result.assetID));
 }
 return next;
}
// Suggestions that are safe to show again after a batch: imported ones are
// removed from the list entirely.
export function suggestionsAfterBatch(suggestions=[],results=[]){
 const done=new Set((results||[]).filter(result=>result.status==='added').map(result=>String(result.assetID)));
 return (suggestions||[]).filter(suggestion=>!done.has(assetKey(suggestion)));
}
// A skip is local to the activity; undo removes the local mark so the candidate
// can be revisited in the same flow without another fetch.
export function markSkipped(suggestions=[],assetID,skipped=true){
 const key=String(assetID);
 return (suggestions||[]).map(suggestion=>assetKey(suggestion)===key?{...suggestion,skipped}:suggestion);
}
// Everything a screen reader needs to describe one candidate without reading the
// thumbnail: what it is, when it was taken, why it is here and whether selected.
export function suggestionLabel(suggestion,{selected=false,timeZone}={}){
 const day=suggestionDay(suggestion,{timeZone});
 const date=captureSeconds(suggestion)==null?'date unknown':`${dayLabel(day)}, ${suggestionTime(suggestion,{timeZone})}`;
 const confidence=suggestionConfidence(suggestion);
 const state=suggestion.skipped?'skipped':selected?'selected':'not selected';
 return `Suggested photo, ${date}, ${confidence.label}, ${state}`;
}
