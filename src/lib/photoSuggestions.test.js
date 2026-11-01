import {describe,expect,it} from 'vitest';
import {
 assetKey,batchMessage,batchSummary,dayLabel,deselectSuggestions,groupSuggestions,isDuplicate,markSkipped,
 planImport,reconcileSelection,selectSuggestions,selectedCount,selectionAfterBatch,suggestionConfidence,
 suggestionDay,suggestionLabel,suggestionsAfterBatch,toggleSelected,visibleSuggestions
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
 it('matches by asset identity or by the same captured moment',()=>{
  expect(isDuplicate(photo('x',at(0)),existing)).toBe(true);
  expect(isDuplicate(photo('known',at(600)),existing)).toBe(true);
  expect(isDuplicate(photo('x',at(59.5)),existing)).toBe(true);
  expect(isDuplicate(photo('x',at(120)),existing)).toBe(false);
 });
 it('never treats an unknown capture time as a duplicate of an unknown photo',()=>{
  expect(isDuplicate({assetID:'x',captureTime:null},[{captureTime:null}])).toBe(false);
 });
 it('plans a batch split into importable and already-present photos',()=>{
  const suggestions=[photo('new',at(120)),photo('old',at(60)),photo('skipped',at(180),{skipped:true})];
  const plan=planImport({suggestions,selected:new Set(['new','old','skipped']),existing});
  expect(plan.ready.map(item=>item.assetID)).toEqual(['new']);
  expect(plan.duplicates.map(item=>item.assetID)).toEqual(['old']);
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
  expect(suggestionConfidence({hasLocation:true}).label).toBe('Date and location match');
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
