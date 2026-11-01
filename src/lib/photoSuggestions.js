// Photo suggestions are candidate photographs that already sit in the person's
// own library. Nothing here uploads, copies or mutates a photo: this module only
// decides which candidates are selected, in what order they are imported, and
// what happened to each one afterwards. Keeping it pure means the same rules are
// used by the sheet, the retry action and the regression tests.
//
// The native suggestion fetch is bounded (fetchLimit in
// ios/App/App/PhotoSuggestions.swift). This constant must match it: when the
// fetch returns this many candidates the sheet says so instead of implying the
// library was searched exhaustively.
export const SUGGESTION_LIMIT=30;
export const fetchTruncated=count=>Number.isFinite(count)&&count>=SUGGESTION_LIMIT;
// Two photos of the same moment can differ by a second after Photos re-encodes
// metadata; anything further apart is a different moment and is never treated as
// a duplicate.
export const DUPLICATE_WINDOW_SECONDS=2;

const finite=Number.isFinite;
export const assetKey=suggestion=>String(suggestion?.assetID??'');
const captureSeconds=suggestion=>finite(suggestion?.captureTime)?suggestion.captureTime:null;

// A photo can be an exact duplicate of one already kept with the activity. The
// import is deduplicated by asset identity first, then by the capture moment the
// activity already stores, so repeatedly tapping Find Photos cannot add the same
// photo twice even though imported copies do not retain a library identifier.
export function isDuplicate(suggestion,existing=[]){
 const key=assetKey(suggestion);
 const time=captureSeconds(suggestion);
 return (existing||[]).some(photo=>{
  if(!photo)return false;
  if(key&&photo.assetID&&String(photo.assetID)===key)return true;
  const kept=finite(photo.captureTime)?photo.captureTime:null;
  return time!=null&&kept!=null&&Math.abs(kept-time)<=DUPLICATE_WINDOW_SECONDS;
 });
}

// Human explanation of why this candidate belongs to the activity. A suggestion
// only exists because the capture time fell inside the activity window; the
// position is only real GPS when the asset carries a location.
export function suggestionConfidence(suggestion){
 if(suggestion?.hasLocation===true)return {id:'gps',label:'Date and location match',detail:'Taken during this activity, with its own location.'};
 if(suggestion?.hasLocation===false)return {id:'time',label:'Date match only',detail:'Only the time matches, so any map position is inferred from the route.'};
 return {id:'unknown',label:'Date match',detail:'Captured during this activity. Location comes from the photo if it has one.'};
}

export function suggestionTime(suggestion){
 const seconds=captureSeconds(suggestion);
 if(seconds==null)return '';
 return new Date(seconds*1000).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'});
}

// Local calendar day, so a photo taken just after midnight is not grouped with
// the previous day because of a UTC offset.
export function suggestionDay(suggestion){
 const seconds=captureSeconds(suggestion);
 if(seconds==null)return 'unknown';
 const date=new Date(seconds*1000);
 return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

export function dayLabel(day){
 if(day==='unknown')return 'Date unknown';
 const [year,month,date]=day.split('-').map(Number);
 return new Date(year,month-1,date).toLocaleDateString('en-AU',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
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

export function groupSuggestions(suggestions,options){
 const groups=[];
 for(const suggestion of visibleSuggestions(suggestions,options)){
  const day=suggestionDay(suggestion);
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

// Results are collected per asset as the import runs, so a partial failure can
// be reported honestly and retried without duplicating the photos that worked.
export function batchSummary(results=[]){
 const added=[],skipped=[],failures=[];
 for(const result of results||[]){
  if(result.status==='added')added.push(result.assetID);
  else if(result.status==='skipped')skipped.push(result.assetID);
  else failures.push({assetID:result.assetID,message:result.message||'Could not be added.'});
 }
 return {total:(results||[]).length,added:added.length,skipped:skipped.length,failed:failures.length,failures,addedIDs:added,skippedIDs:skipped};
}
export function batchMessage(summary){
 if(!summary||!summary.total)return '';
 const parts=[`${summary.added} added`];
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
export function suggestionLabel(suggestion,{selected=false}={}){
 const date=captureSeconds(suggestion)==null?'date unknown':new Date(suggestion.captureTime*1000).toLocaleString('en-AU',{day:'numeric',month:'long',hour:'numeric',minute:'2-digit'});
 const confidence=suggestionConfidence(suggestion);
 const state=suggestion.skipped?'skipped':selected?'selected':'not selected';
 return `Suggested photo, ${date}, ${confidence.label}, ${state}`;
}
