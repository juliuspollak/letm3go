import {describe,expect,it} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import {cachedKnownTags,knownTags,normaliseTag,tagChoice,tagKey,tagSuggestions,TAG_LIMIT,TAG_SUGGESTION_LIMIT} from './tagSearch.js';
import {alreadyApplied,tagAction,TAG_ACTION_LABELS} from './tagMessaging.js';

describe('tags the person already uses',()=>{
 it('treats capitals and extra spacing as one tag, never a second one',()=>{
  expect(normaliseTag('  Bike   shop ')).toBe('Bike shop');
  expect(tagKey(' BUNNINGS ')).toBe('bunnings');
  expect(normaliseTag(undefined)).toBe('');
 });
 it('lists the tags in use, newest activity first, once each',()=>{
  const journeys=[{startedAt:100,tags:['Bunnings','Coffee']},{startedAt:300,tags:['Coast walk','bunnings']},{startedAt:200,tags:['Coffee stop','']},{startedAt:400,tags:[`${'x'.repeat(51)}`]}];
  expect(knownTags(journeys)).toEqual(['Coast walk','bunnings','Coffee stop','Coffee']);
  expect(knownTags()).toEqual([]);
 });
 it('does not walk the journal again for the same projection',()=>{
  const journeys=[{startedAt:1,tags:['Coffee']}];
  expect(cachedKnownTags(journeys)).toBe(cachedKnownTags(journeys));
  expect(cachedKnownTags(undefined)).toEqual([]);
 });
 it('still offers a tag that only an old trip carries',()=>{
  // The journal is ordered newest first, so a cap on the list used to hide exactly
  // the names a person was least likely to remember typing.
  const journeys=Array.from({length:400},(_,i)=>({startedAt:10_000-i,tags:[`Tag ${i}`]}));
  const known=knownTags(journeys);
  expect(known).toHaveLength(400);
  expect(known.at(-1)).toBe('Tag 399');
  expect(tagSuggestions({known,query:'tag 399'})).toEqual(['Tag 399']);
  expect(knownTags([{startedAt:1,tags:['Bunnings']}])).toHaveLength(1);
  expect(TAG_LIMIT).toBe(20);
 });
 it('suggests matching tags as the person types, prefixes first',()=>{
  const known=['Bike shop','Coffee','Coffee stop','Coast walk'];
  expect(tagSuggestions({known,query:'co'})).toEqual(['Coffee','Coast walk','Coffee stop']);
  expect(tagSuggestions({known,query:'COF'})).toEqual(['Coffee','Coffee stop']);
  expect(tagSuggestions({known,query:'shop'})).toEqual(['Bike shop']);
  expect(tagSuggestions({known,query:'co',limit:1})).toEqual(['Coffee']);
  expect(tagSuggestions({known,query:'  '})).toEqual([]);
  expect(tagSuggestions()).toEqual([]);
 });
 it('never offers a tag the activity already carries',()=>{
  const known=['Coffee','Coffee stop'];
  expect(tagSuggestions({known,applied:['coffee '],query:'co'})).toEqual(['Coffee stop']);
 });
 it('keeps the spelling already in use instead of adding a near duplicate',()=>{
  expect(tagChoice({known:['Bunnings'],query:'bunnings  '})).toEqual({name:'Bunnings',applied:false,create:false});
  expect(tagChoice({known:['Bunnings'],applied:['Coffee'],query:'coffee'})).toEqual({name:'Coffee',applied:true,create:false});
  expect(tagChoice({known:[],query:' New   Place '})).toEqual({name:'New Place',applied:false,create:true});
  expect(tagChoice({query:'   '})).toEqual({name:'',applied:false,create:false});
 });
 it('is the contract TagSearch (ActivityDetailsCore.swift) implements',()=>{
  // 'Car', 'bar' and 'Ear' tie on prefix and length for 'ar': the order then comes
  // from localeCompare (alphabetical, not uppercase-first), which Swift must match.
  const known=['Bunnings','Coffee','Coffee stop','Coast walk','Bike shop','Bunnings Warehouse','bunnings tyre centre','BUNNINGS','Car','bar','Ear'];
  const cases=[
   {query:'bun',applied:[],limit:TAG_SUGGESTION_LIMIT},
   {query:' co ',applied:[],limit:TAG_SUGGESTION_LIMIT},
   {query:'COF',applied:[],limit:TAG_SUGGESTION_LIMIT},
   {query:'co',applied:['Coffee'],limit:TAG_SUGGESTION_LIMIT},
   {query:'bunnings',applied:[],limit:TAG_SUGGESTION_LIMIT},
   {query:'coffee',applied:['Coffee'],limit:TAG_SUGGESTION_LIMIT},
   {query:'zzz',applied:[],limit:TAG_SUGGESTION_LIMIT},
   {query:'   ',applied:[],limit:TAG_SUGGESTION_LIMIT},
   {query:'co',applied:[],limit:2},
   {query:'ar',applied:[],limit:TAG_SUGGESTION_LIMIT}
  ].map(test=>({...test,suggestions:tagSuggestions({known,query:test.query,applied:test.applied,limit:test.limit}),choice:tagChoice({known,query:test.query,applied:test.applied})}));
  // The button's rule travels with the search contract: both screens must name a
  // press the same way, and neither may offer to remember when it will not.
  const actions=[
   {name:'',applied:false,remembering:false},
   {name:'Burger',applied:false,remembering:false},
   {name:'Burger',applied:false,remembering:true},
   {name:'Bunnings',applied:true,remembering:false},
   {name:'Bunnings',applied:true,remembering:true},
   {name:'  ',applied:true,remembering:true}
  ].map(test=>({...test,action:tagAction(test)?.kind||null}));
  const current=JSON.stringify({limits:{suggestion:TAG_SUGGESTION_LIMIT,tagLength:50,tagLimit:TAG_LIMIT},labels:TAG_ACTION_LABELS,known,cases,actions},null,1)+'\n';
  const fixture=`${process.cwd()}/tests/fixtures/tag-search.json`;
  if(process.env.UPDATE_FIXTURES)writeFileSync(fixture,current);
  expect(JSON.parse(readFileSync(fixture,'utf8'))).toEqual(JSON.parse(current));
 });
 it('names the action a press will take instead of promising nothing',()=>{
  expect(tagAction({name:'Burger'})).toEqual({kind:'add',label:TAG_ACTION_LABELS.add,enabled:true});
  expect(tagAction({name:'Burger',remembering:true})).toEqual({kind:'remember',label:TAG_ACTION_LABELS.remember,enabled:true});
  expect(tagAction({name:'Bunnings',applied:true})).toMatchObject({kind:'applied',label:TAG_ACTION_LABELS.applied,enabled:false,explanation:alreadyApplied});
  expect(tagAction({name:'Bunnings',applied:true,remembering:true})).toEqual({kind:'remember',label:TAG_ACTION_LABELS.remember,enabled:true});
  expect(tagAction({name:'  '})).toBeNull();
 });
});
