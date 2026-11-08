import {describe,expect,it,vi} from 'vitest';
import {commitTagAndPlace} from './tagCommit.js';

const tags=body=>({type:'manualTags',anchor:'a',tags:body});
const saved='Saved Bunnings as a place. Future trips ending within 200 m are named Bunnings.';

describe('one press, two writes',()=>{
 it('adds the tag and saves the place when both were asked for',async()=>{
  const addTag=vi.fn().mockResolvedValue(true),savePlace=vi.fn().mockResolvedValue({});
  const result=await commitTagAndPlace({name:'Bunnings',custom:[],remember:true,addTag,savePlace});
  expect(addTag).toHaveBeenCalledWith(['Bunnings']);
  expect(savePlace).toHaveBeenCalledWith('Bunnings');
  expect(result).toEqual({tag:'added',place:'saved',name:'Bunnings',clear:true,notice:saved});
 });
 it('saves the place even when the activity already carries the tag',async()=>{
  const addTag=vi.fn(),savePlace=vi.fn().mockResolvedValue({});
  const result=await commitTagAndPlace({name:'bunnings',applied:['Bunnings'],custom:['Bunnings'],remember:true,addTag,savePlace});
  expect(addTag).not.toHaveBeenCalled();
  expect(savePlace).toHaveBeenCalledWith('Bunnings');
  expect(result).toMatchObject({tag:'applied',place:'saved',clear:true,notice:saved});
 });
 it('writes nothing at all for a tag that is already there and nothing to save',async()=>{
  const addTag=vi.fn(),savePlace=vi.fn();
  const result=await commitTagAndPlace({name:'Bunnings',applied:['Bunnings'],addTag,savePlace});
  expect(addTag).not.toHaveBeenCalled();expect(savePlace).not.toHaveBeenCalled();
  expect(result).toMatchObject({tag:'applied',place:'skipped',clear:true});
  expect(result.notice).toBe('That tag is already on this trip. Turn on “Remember the destination” to save it as a place.');
 });
 it('refuses a new tag once the trip has its limit, without writing either half',async()=>{
  const addTag=vi.fn(),savePlace=vi.fn();
  const result=await commitTagAndPlace({name:'Bunnings',custom:Array.from({length:20},(_,i)=>`Tag ${i}`),remember:true,limit:20,addTag,savePlace});
  expect(addTag).not.toHaveBeenCalled();expect(savePlace).not.toHaveBeenCalled();
  expect(result).toMatchObject({tag:'failed',place:'skipped',name:'Bunnings',clear:false,notice:'This trip already has 20 tags. Remove one before adding another.'});
 });
 it('keeps the tag and says the place is still outstanding when saving fails',async()=>{
  const addTag=vi.fn().mockResolvedValue(true),savePlace=vi.fn().mockRejectedValue(new Error('The recorder is offline.'));
  const result=await commitTagAndPlace({name:'Bunnings',remember:true,addTag,savePlace});
  expect(result).toEqual({tag:'added',place:'failed',name:'Bunnings',clear:false,
   notice:'Tag added to this trip only. The recorder is offline. Try again to save the destination.'});
 });
 it('keeps the saved place and says the tag is still outstanding when that write fails',async()=>{
  const addTag=vi.fn().mockResolvedValue(false),savePlace=vi.fn().mockResolvedValue({});
  const result=await commitTagAndPlace({name:'Bunnings',remember:true,addTag,savePlace});
  expect(result).toEqual({tag:'failed',place:'saved',name:'Bunnings',clear:false,
   notice:`${saved} The tag was not added. Try again to add it.`});
 });
 it('treats a thrown tag write as a failure rather than a success',async()=>{
  const addTag=vi.fn().mockRejectedValue(new Error('offline')),savePlace=vi.fn().mockResolvedValue({});
  expect((await commitTagAndPlace({name:'Bunnings',remember:true,addTag,savePlace})).tag).toBe('failed');
 });
 it('never reports a whole success when both halves failed',async()=>{
  const addTag=vi.fn().mockResolvedValue(false),savePlace=vi.fn().mockRejectedValue(new Error(''));
  const result=await commitTagAndPlace({name:'Bunnings',remember:true,addTag,savePlace});
  expect(result).toEqual({tag:'failed',place:'failed',name:'Bunnings',clear:false,
   notice:'The destination was not saved. The tag was not added either. Try again to save the destination.'});
 });
 it('does nothing for an empty name, so a stray Enter cannot write',async()=>{
  const addTag=vi.fn(),savePlace=vi.fn();
  expect(await commitTagAndPlace({name:'   ',remember:true,addTag,savePlace})).toEqual({tag:'skipped',place:'skipped',name:'',clear:true,notice:''});
  expect(addTag).not.toHaveBeenCalled();expect(savePlace).not.toHaveBeenCalled();
 });
 it('keeps one spelling of a tag the person already uses',async()=>{
  const addTag=vi.fn().mockResolvedValue(true);
  await commitTagAndPlace({name:'  coffee  ',known:['Coffee'],custom:[],addTag});
  expect(addTag).toHaveBeenCalledWith(tags(['Coffee']).tags);
 });
 it('appends to the tags already on the trip instead of replacing them',async()=>{
  const addTag=vi.fn().mockResolvedValue(true);
  await commitTagAndPlace({name:'Fuel',known:[],custom:['Bunnings'],addTag});
  expect(addTag).toHaveBeenCalledWith(['Bunnings','Fuel']);
 });
});
