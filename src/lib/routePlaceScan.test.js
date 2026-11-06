import {expect,it,vi,beforeEach} from 'vitest';
const mock=vi.hoisted(()=>({lookup:vi.fn()}));
vi.mock('./recorder.js',()=>({recorder:{recogniseTripPlace:mock.lookup}}));
import {scanRoutePlaces} from './routePlaceScan.js';
import {placeKey} from './journeyGrouping.js';

const home={latitude:-34.545,longitude:150.865,timestamp:10000,accuracy:5,segment:0};
const shop={latitude:-34.55,longitude:150.87,timestamp:10600,accuracy:5,segment:0};
const mall={name:'Warilla Grove',category:'shoppingCentre',latitude:shop.latitude+.0003,longitude:shop.longitude};
const trip={id:'shopping',activity:'Driving',points:[home,shop,{...shop,timestamp:11291,segment:1},
 {...home,timestamp:12000,segment:1}],tags:[],recognisedStops:[{pointIndex:1,segmentID:'shopping',
 durationSeconds:691,startedAt:10600,endedAt:11291}]};

beforeEach(()=>{mock.lookup.mockReset();});
it('refreshes a cached route-only search for a native stop',async()=>{
 mock.lookup.mockImplementation(async(_id,_index,point)=>({source:'apple-geocoder-mapkit',candidates:point.latitude===shop.latitude?[mall]:[]}));
 const places={[placeKey(shop)]:{source:'apple-geocoder-mapkit',candidates:[{name:'Petbarn',category:'store'}]},
  [placeKey(home)]:{source:'saved-place',locality:'Home'}};
 const result=await scanRoutePlaces(trip,{places});
 expect(mock.lookup).toHaveBeenCalledWith(null,0,shop,true);
 expect(result.suggestions.map(s=>s.name)).toContain('Warilla Grove');
 expect(result.suggestions.map(s=>s.name)).not.toContain('Petbarn');
});
it('reuses a completed stop search without unnecessarily calling the provider',async()=>{
 const places={[placeKey(shop)]:{source:'apple-geocoder-mapkit',stopLookup:true,candidates:[mall]},
  [placeKey(home)]:{source:'saved-place',locality:'Home'}};
 const result=await scanRoutePlaces(trip,{places});
 expect(mock.lookup).not.toHaveBeenCalled();
 expect(result.suggestions.map(s=>s.name)).toContain('Warilla Grove');
});
it('honours a hidden venue in manual stop suggestions',async()=>{
 const places={[placeKey(shop)]:{source:'apple-geocoder-mapkit',stopLookup:true,candidates:[mall]},
  [placeKey(home)]:{source:'saved-place',locality:'Home'}};
 const result=await scanRoutePlaces(trip,{places,hidden:['Warilla Grove']});
 expect(result.suggestions.map(s=>s.name)).not.toContain('Warilla Grove');
});


it('offers competing shopping centres for confirmation without asserting either automatically',async()=>{
 const rival={...mall,name:'Another Shopping Centre',latitude:shop.latitude+.0005};
 const places={[placeKey(shop)]:{source:'apple-geocoder-mapkit',stopLookup:true,candidates:[mall,rival]},
  [placeKey(home)]:{source:'saved-place',locality:'Home'}};
 const result=await scanRoutePlaces(trip,{places});
 expect(result.suggestions.map(s=>s.name)).toEqual(expect.arrayContaining(['Warilla Grove','Another Shopping Centre']));
 expect(mock.lookup).not.toHaveBeenCalled();
});
