import {describe,expect,it,vi} from 'vitest';
import {rememberDestinationPlace,rememberedPlaceAt} from './rememberedPlace.js';

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
  const saved=await rememberDestinationPlace({trip,run,grouping:{metadata:{places:{}}},name:'  Bunnings  '});
  expect(run).toHaveBeenCalledWith('savePlace',{name:'Bunnings',kind:'favourite',latitude:-34.4,longitude:150.9,radius:200});
  expect(saved).toMatchObject({name:'Bunnings',radius:200,notice:'Saved Bunnings as a place. Future trips ending within 200 m are named Bunnings.'});
 });
 it('reuses the place already covering the end instead of adding a twin',async()=>{
  const run=vi.fn().mockResolvedValue({places:[]});
  await rememberDestinationPlace({trip,run,grouping:{metadata:{places:{a:bunnings}}},name:'bunnings'});
  expect(run).toHaveBeenCalledWith('savePlace',{id:bunnings.id,name:'bunnings',kind:'favourite',latitude:-34.4,longitude:150.9,radius:200});
 });
 it('leaves a foreign place id alone',async()=>{
  const run=vi.fn().mockResolvedValue({places:[]});
  await rememberDestinationPlace({trip,run,grouping:{metadata:{places:{a:{...bunnings,id:'apple:shop'}}}},name:'Bunnings'});
  expect(run.mock.calls[0][1]).not.toHaveProperty('id');
 });
 it('says why it could not save rather than failing silently',async()=>{
  const run=vi.fn().mockResolvedValue(null);
  await expect(rememberDestinationPlace({trip,run,grouping:{},name:'Bunnings'})).rejects.toThrow('Could not save the destination.');
  await expect(rememberDestinationPlace({trip:{points:[]},run,grouping:{},name:'Bunnings'})).rejects.toThrow('no end point');
  await expect(rememberDestinationPlace({trip,grouping:{},name:'Bunnings'})).rejects.toThrow('needs the recorder');
  await expect(rememberDestinationPlace({trip,run,grouping:{},name:'  '})).rejects.toThrow('Enter a name');
 });
});
