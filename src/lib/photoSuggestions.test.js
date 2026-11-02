import {describe,expect,it} from 'vitest';
import {
 assetKey,batchMessage,batchSummary,dayLabel,deselectSuggestions,groupSuggestions,isDuplicate,markSkipped,
 mergeBatchResults,mergeSuggestionPages,nextSuggestionOffset,planImport,reconcileSelection,sameCaptureMoment,selectSuggestions,selectedCount,
 selectionAfterBatch,suggestionConfidence,suggestionDay,suggestionLabel,suggestionsAfterBatch,toggleSelected,visibleSuggestions
} from './photoSuggestions.js';

// Local noon on 1 November 2026: grouping is intentionally local-calendar based,
// so the fixture must be built in local time to stay deterministic everywhere.
const at=s=>new Date(2026,10,1,12,0,s).getTime()/1000;
const photo=(assetID,captureTime,extra={})=>({assetID,thumbnail:`data:${assetID}`,captureTime,...extra});

describe('suggestion eligibility and ordering',()=>{
 it('groups by local calendar day and keeps capture order',()=>{
  const items=[photo('c',at(30)),photo('a',at(5)),photo('b',at(10),{skipped:true})];
  expect(visibleSuggestions(items).map(assetKey)).toEqual(['a','c']);
  expect(visibleSuggestions(items,{showSkipped:true}).map(assetKey)).toEqual(['a','b','c']);
  const groups=groupSuggestions(items,{showSkipped:true});
  expect(groups).toHaveLength(1);
  expect(groups[0].items.map(assetKey)).toEqual(['a','b','c']);
  expect(dayLabel(groups[0].day)).toBe('Sun, 1 Nov 2026');
 });
 it('separates days and handles a missing capture time without inventing one',()=>{
  const items=[photo('a',at(0)),photo('b',at(0)+86400),{assetID:'c',captureTime:null}];
  expect(groupSuggestions(items).map(g=>g.label)).toEqual(['Sun, 1 Nov 2026','Mon, 2 Nov 2026','Date unknown']);
  expect(suggestionDay({captureTime:null})).toBe('unknown');
 });
 it('ignores malformed suggestions instead of rendering an unselectable tile',()=>{
  expect(visibleSuggestions([null,{},{assetID:''},photo('ok',at(0))]).map(assetKey)).toEqual(['ok']);
 });
 // A photo taken just after midnight is "today" where the activity happened, not
 // wherever the phone is now. 22:30 UTC on 1 November is 09:30 on 2 November in
 // Sydney, so the day label must follow the activity's own timezone.
 const abroad=Date.UTC(2026,10,1,22,30)/1000;
 it('groups by the activity timezone rather than the device timezone',()=>{
  expect(suggestionDay({captureTime:abroad},{timeZone:'UTC'})).toBe('2026-11-01');
  expect(suggestionDay({captureTime:abroad},{timeZone:'Australia/Sydney'})).toBe('2026-11-02');
  expect(dayLabel(suggestionDay({captureTime:abroad},{timeZone:'Australia/Sydney'}))).toBe('Mon, 2 Nov 2026');
 });
 it('applies the daylight-saving offset in force on the capture date',()=>{
  // Sydney switches to daylight saving on 4 October 2026. 13:30 UTC is 23:30 on
  // 4 October under a fixed +10 offset, but the real +11 offset makes it 00:30 on
  // 5 October — the day the person actually experienced.
  const dstEdge=Date.UTC(2026,9,4,13,30)/1000;
  expect(suggestionDay({captureTime:dstEdge},{timeZone:'Australia/Sydney'})).toBe('2026-10-05');
  expect(suggestionDay({captureTime:dstEdge},{timeZone:'UTC'})).toBe('2026-10-04');
 });
 it('splits groups on the activity calendar day',()=>{
  const items=[photo('late',Date.UTC(2026,10,1,22,30)/1000),photo('next',Date.UTC(2026,10,2,5,0)/1000)];
  expect(groupSuggestions(items,{timeZone:'Australia/Sydney'}).map(g=>g.label)).toEqual(['Mon, 2 Nov 2026']);
  expect(groupSuggestions(items,{timeZone:'UTC'}).map(g=>g.label)).toEqual(['Sun, 1 Nov 2026','Mon, 2 Nov 2026']);
 });
});

describe('selection',()=>{
 const items=[photo('a',at(0)),photo('b',at(10)),photo('c',at(20),{skipped:true})];
 it('toggles one photo without disturbing the rest',()=>{
  let selected=new Set();
  selected=toggleSelected(selected,'a');
  selected=toggleSelected(selected,'b');
  expect(selectedCount(selected,items)).toBe(2);
  expect([...toggleSelected(selected,'a')]).toEqual(['b']);
 });
 it('selects and deselects every eligible photo but never a skipped one',()=>{
  const all=selectSuggestions(new Set(),items);
  expect([...all].sort()).toEqual(['a','b']);
  expect([...deselectSuggestions(all,items)]).toEqual([]);
 });
 it('keeps a selection across a refresh and drops photos no longer eligible',()=>{
  const refreshed=[photo('a',at(0)),photo('b',at(10),{skipped:true}),photo('d',at(30))];
  expect([...reconcileSelection(new Set(['a','b','gone']),refreshed)]).toEqual(['a']);
 });
});

describe('duplicate prevention',()=>{
 const existing=[{captureTime:at(0)},{captureTime:at(60),assetID:'known'}];
 it('blocks only the same library asset, never a nearby timestamp',()=>{
  expect(isDuplicate(photo('known',at(600)),existing)).toBe(true);
  expect(isDuplicate(photo('x',at(0)),existing)).toBe(false);
  expect(isDuplicate({assetID:'',captureTime:at(0)},existing)).toBe(false);
 });
 it('still names the same captured moment without blocking the import',()=>{
  expect(sameCaptureMoment(photo('x',at(0)),existing)).toBe(true);
  expect(sameCaptureMoment(photo('x',at(59.5)),existing)).toBe(true);
  expect(sameCaptureMoment(photo('x',at(120)),existing)).toBe(false);
  expect(sameCaptureMoment({assetID:'x',captureTime:null},[{captureTime:null}])).toBe(false);
 });
 it('plans a batch split into importable and already-present photos',()=>{
  const suggestions=[photo('new',at(120)),photo('known',at(60)),photo('skipped',at(180),{skipped:true})];
  const plan=planImport({suggestions,selected:new Set(['new','known','skipped']),existing});
  expect(plan.ready.map(item=>item.assetID)).toEqual(['new']);
  expect(plan.duplicates.map(item=>item.assetID)).toEqual(['known']);
 });
 it('respects an explicit selection rather than importing every visible photo',()=>{
  const suggestions=[photo('a',at(0)),photo('b',at(10))];
  expect(planImport({suggestions,selected:new Set(['b'])}).ready.map(item=>item.assetID)).toEqual(['b']);
 });
});

describe('batch results',()=>{
 const results=[{assetID:'a',status:'added'},{assetID:'b',status:'failed',message:'Not available locally.'},{assetID:'c',status:'skipped'}];
 it('reports added, failed and already-present honestly',()=>{
  const summary=batchSummary(results);
  expect(summary).toMatchObject({total:3,added:1,failed:1,skipped:1});
  expect(summary.failures).toEqual([{assetID:'b',message:'Not available locally.'}]);
  expect(batchMessage(summary)).toBe('1 added · 1 failed · 1 already with this activity');
 });
 it('keeps only failures selected for a retry and removes imported suggestions',()=>{
  expect([...selectionAfterBatch(new Set(['a','b','c']),results)]).toEqual(['b']);
  const remaining=suggestionsAfterBatch([photo('a',at(0)),photo('b',at(10)),photo('c',at(20))],results);
  expect(remaining.map(assetKey)).toEqual(['b','c']);
 });
 it('describes a batch with no work without a misleading message',()=>{
  expect(batchMessage(batchSummary([]))).toBe('');
 });
 it('merges a retry into the earlier batch instead of forgetting prior successes',()=>{
  const earlier=[{assetID:'a',status:'added'},{assetID:'b',status:'failed',message:'Not available locally.'},{assetID:'skipped',status:'skipped'}];
  const retry=[{assetID:'b',status:'added'}];
  const merged=mergeBatchResults(earlier,retry);
  expect(merged.map(result=>`${result.assetID}:${result.status}`)).toEqual(['a:added','b:added','skipped:skipped']);
  expect(batchMessage(batchSummary(merged))).toBe('2 added · 1 already with this activity');
  // A result for an asset that was not in the earlier batch is appended, not lost.
  expect(mergeBatchResults(earlier,[{assetID:'d',status:'added'}]).map(result=>result.assetID)).toEqual(['a','b','skipped','d']);
 });
});

describe('skip, revisit and accessibility',()=>{
 it('marks and unmarks a skip without losing other suggestion data',()=>{
  const items=[photo('a',at(0)),photo('b',at(10))];
  const skipped=markSkipped(items,'a');
  expect(skipped[0].skipped).toBe(true);
  expect(visibleSuggestions(skipped).map(assetKey)).toEqual(['b']);
  expect(visibleSuggestions(markSkipped(skipped,'a',false)).map(assetKey)).toEqual(['a','b']);
 });
 it('explains confidence from what is actually known',()=>{
  expect(suggestionConfidence({hasLocation:true}).label).toBe('Date match · photo GPS');
  expect(suggestionConfidence({hasLocation:false}).detail).toContain('inferred');
  expect(suggestionConfidence({}).id).toBe('unknown');
 });
 it('gives each candidate a selection-aware VoiceOver label',()=>{
  const label=suggestionLabel({assetID:'a',captureTime:at(0),hasLocation:false},{selected:true});
  expect(label).toContain('Suggested photo');
  expect(label).toContain('Date match only');
  expect(label).toContain('selected');
  expect(suggestionLabel({assetID:'a',captureTime:null})).toContain('not selected');
 });
});

describe('paged suggestions',()=>{
 it('appends the next page and never shows the same asset twice',()=>{
  const first=[photo('a',at(0)),photo('b',at(10))];
  const next=mergeSuggestionPages(first,[photo('b',at(10)),photo('c',at(20)),null]);
  expect(next.map(assetKey)).toEqual(['a','b','c']);
  expect(mergeSuggestionPages(first,[]).map(assetKey)).toEqual(['a','b']);
  expect(mergeSuggestionPages([],first).map(assetKey)).toEqual(['a','b']);
 });
 it('asks for the next page by the number of distinct candidates already held',()=>{
  expect(nextSuggestionOffset([])).toBe(0);
  expect(nextSuggestionOffset([photo('a',at(0)),photo('b',at(10))])).toBe(2);
  // A duplicated row from Photos must not make the next page skip an asset.
  expect(nextSuggestionOffset([photo('a',at(0)),photo('a',at(0)),photo('b',at(10))])).toBe(2);
 });
});
