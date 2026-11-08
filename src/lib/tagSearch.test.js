import {describe,expect,it} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import {cachedKnownTags,knownTags,normaliseTag,tagChoice,tagKey,tagSuggestions,KNOWN_TAG_LIMIT,TAG_SUGGESTION_LIMIT} from './tagSearch.js';

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
  expect(knownTags(Array.from({length:KNOWN_TAG_LIMIT+40},(_,i)=>({startedAt:i,tags:[`Tag ${i}`]})))).toHaveLength(KNOWN_TAG_LIMIT);
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
  const known=['Bunnings','Coffee','Coffee stop','Coast walk','Bike shop','Bunnings Warehouse','bunnings tyre centre','BUNNINGS'];
  const cases=[
   {query:'bun',applied:[],limit:TAG_SUGGESTION_LIMIT},
   {query:' co ',applied:[],limit:TAG_SUGGESTION_LIMIT},
   {query:'COF',applied:[],limit:TAG_SUGGESTION_LIMIT},
   {query:'co',applied:['Coffee'],limit:TAG_SUGGESTION_LIMIT},
   {query:'bunnings',applied:[],limit:TAG_SUGGESTION_LIMIT},
   {query:'coffee',applied:['Coffee'],limit:TAG_SUGGESTION_LIMIT},
   {query:'zzz',applied:[],limit:TAG_SUGGESTION_LIMIT},
   {query:'   ',applied:[],limit:TAG_SUGGESTION_LIMIT},
   {query:'co',applied:[],limit:2}
  ].map(test=>({...test,suggestions:tagSuggestions({known,query:test.query,applied:test.applied,limit:test.limit}),choice:tagChoice({known,query:test.query,applied:test.applied})}));
  const current=JSON.stringify({limits:{suggestion:TAG_SUGGESTION_LIMIT,tagLength:50},known,cases},null,1)+'\n';
  const fixture=`${process.cwd()}/tests/fixtures/tag-search.json`;
  if(process.env.UPDATE_FIXTURES)writeFileSync(fixture,current);
  expect(JSON.parse(readFileSync(fixture,'utf8'))).toEqual(JSON.parse(current));
 });
});
