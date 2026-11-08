import {describe,expect,it,vi} from 'vitest';
import {personalPlace,PERSONAL_PLACE_KINDS,rememberDestinationPlace,rememberedPlaceAt,savedPlaceRadius} from './rememberedPlace.js';

const bunnings={id:'11111111-1111-4111-8111-111111111111',name:'Bunnings',kind:'favourite',latitude:-34.4,longitude:150.9,radius:200};
const home={id:'22222222-2222-4222-8222-222222222222',name:'Home',kind:'home',latitude:-34.4,longitude:150.9,radius:150};
const trip={id:'trip-1',points:[{latitude:-34.4,longitude:150.9,timestamp:1790000000,accuracy:5}]};

describe('remembered places',()=>{
 it('finds the saved place that covers a point, nearest first',()=>{
  expect(rememberedPlaceAt([bunnings,home],{latitude:-34.4,longitude:150.9})).toMatchObject({name:'Bunnings',radius:200,metres:0});
  expect(rememberedPlaceAt([bunnings],{latitude:-34.6,longitude:150.9})).toBeNull();
  expect(rememberedPlaceAt(null,{latitude:1,longitude:1})).toBeNull();
  expect(rememberedPlaceAt([bunnings],{})).toBeNull();
  expect(rememberedPlaceAt({a:{...bunnings,id:'x'}},{latitude:-34.4,longitude:150.9})).toMatchObject({id:'x',name:'Bunnings'});
 });
 it('saves one place where the activity ended, so future trips recognise it',async()=>{
  const run=vi.fn().mockResolvedValue({places:[]});
  const saved=await rememberDestinationPlace({trip,run,places:[],name:'  Bunnings  '});
  expect(run).toHaveBeenCalledWith('savePlace',{name:'Bunnings',kind:'favourite',latitude:-34.4,longitude:150.9,radius:200});
  expect(saved).toMatchObject({name:'Bunnings',radius:200,notice:'Saved Bunnings as a place. Future trips ending within 200 m are named Bunnings.'});
 });
 it('reuses the place already covering the end instead of adding a twin',async()=>{
  const run=vi.fn().mockResolvedValue({places:[]});
  await rememberDestinationPlace({trip,run,places:[bunnings],name:'bunnings'});
  expect(run).toHaveBeenCalledWith('savePlace',{id:bunnings.id,name:'bunnings',kind:'favourite',latitude:-34.4,longitude:150.9,radius:200});
 });
 it('leaves a foreign place id alone',async()=>{
  const run=vi.fn().mockResolvedValue({places:[]});
  await rememberDestinationPlace({trip,run,places:[{...bunnings,id:'apple:shop'}],name:'Bunnings'});
  expect(run.mock.calls[0][1]).not.toHaveProperty('id');
 });
 it('says why it could not save rather than failing silently',async()=>{
  const run=vi.fn().mockResolvedValue(null);
  await expect(rememberDestinationPlace({trip,run,grouping:{},name:'Bunnings'})).rejects.toThrow('Could not save the destination.');
  await expect(rememberDestinationPlace({trip:{points:[]},run,grouping:{},name:'Bunnings'})).rejects.toThrow('no end point');
  await expect(rememberDestinationPlace({trip,grouping:{},name:'Bunnings'})).rejects.toThrow('needs the recorder');
  await expect(rememberDestinationPlace({trip,run,grouping:{},name:'  '})).rejects.toThrow('Enter a name');
 });
 it("names the recorder's own reason for a failed save",async()=>{
  const run=vi.fn().mockResolvedValue(null);
  await expect(rememberDestinationPlace({trip,run,grouping:{},name:'Bunnings',lastError:()=>'The recorder is offline.'})).rejects.toThrow('The recorder is offline.');
  // A recorder that reports no reason still gets a truthful sentence.
  await expect(rememberDestinationPlace({trip,run,grouping:{},name:'Bunnings',lastError:()=>''})).rejects.toThrow('Could not save the destination.');
 });
 it('leaves Home and Work out of remembered destinations',()=>{
  // Recognition never titles a trip with Home or Work, so the tags section must not
  // claim one is a recognised destination either.
  expect(rememberedPlaceAt([home,bunnings],{latitude:-34.4,longitude:150.9})).toMatchObject({name:'Bunnings',kind:'favourite'});
  const personal={...home,id:'work',name:'Work',kind:'work',radius:200};
  expect(rememberedPlaceAt([personal],{latitude:-34.4,longitude:150.9})).toBeNull();
  expect(rememberedPlaceAt([personal],{latitude:-34.4,longitude:150.9},{includePersonal:true})).toMatchObject({name:'Work',kind:'work'});
  expect(PERSONAL_PLACE_KINDS).toEqual(['home','work']);
  expect(personalPlace({kind:'Work'})).toBe(true);
  expect(personalPlace({kind:'favourite'})).toBe(false);
 });
 it('measures every place against the same fence, whatever was stored',()=>{
  expect(savedPlaceRadius({radius:200})).toBe(200);
  expect(savedPlaceRadius({radius:10})).toBe(50);
  expect(savedPlaceRadius({radius:9000})).toBe(2000);
  expect(savedPlaceRadius({})).toBe(200);
  const tiny={...bunnings,radius:20};
  // 60 m away: inside the stored 20 m, but the shared minimum is 50 m, so this is
  // the same answer recognition would give.
  expect(rememberedPlaceAt([tiny],{latitude:-34.4,longitude:150.9})).toMatchObject({radius:50});
  expect(rememberedPlaceAt([{...bunnings,radius:Number.NaN}],{latitude:-34.4,longitude:150.9})).toMatchObject({radius:200});
 });
 it('does not reuse a place of the same name that is somewhere else',async()=>{
  const run=vi.fn().mockResolvedValue({places:[]});
  const far={...bunnings,latitude:-34.9};
  await rememberDestinationPlace({trip,run,places:[far],name:'Bunnings'});
  expect(run.mock.calls[0][1]).not.toHaveProperty('id');
 });
 it('never reuses Home as the destination, even under the same name',async()=>{
  const run=vi.fn().mockResolvedValue({places:[]});
  const named={...home,kind:'favourite'};
  await rememberDestinationPlace({trip,run,places:[named],name:'Home'});
  expect(run.mock.calls[0][1]).toMatchObject({name:'Home',kind:'favourite'});
  const work={...home,id:'33333333-3333-4333-8333-333333333333',name:'Work',kind:'work'};
  await rememberDestinationPlace({trip,run,places:[work],name:'Work'});
  expect(run.mock.calls[1][1]).not.toHaveProperty('id');
 });
 it('reuses the place where the activity ends and keeps the existing radius',async()=>{
  const run=vi.fn().mockResolvedValue({places:[]});
  const wide={...bunnings,radius:800};
  const saved=await rememberDestinationPlace({trip,run,places:[wide],name:'Bunnings'});
  // Reusing the record does not silently resize the fence the person already has.
  expect(run.mock.calls[0][1]).toMatchObject({id:bunnings.id});
  expect(saved).toMatchObject({id:bunnings.id,name:'Bunnings'});
 });
});
