import {it,expect,vi,afterEach} from 'vitest';
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('./supabase.js',()=>({supabase:{rpc}}));
import {fetchWatchSegments} from './mtbApi.js';
afterEach(()=>vi.resetAllMocks());
it('joins the current activity catalogue with matching-version direction metadata',async()=>{
 const geometry=[[0,0],[0,1]];
 rpc.mockImplementation(async name=>({data:name==='segments_for_map'?[{id:'s',version:2,activity:'MTB',geometry}]:[{id:'s',version:2,direction:'both',status:'approved',visibility:'public'}]}));
 const result=await fetchWatchSegments({minLat:0,maxLat:1,minLon:0,maxLon:1});
 expect(result).toEqual([{id:'s',version:2,activity:'MTB',geometry,direction:'both',status:'approved',visibility:'public'}]);
 expect(rpc).toHaveBeenCalledTimes(2);
});
it('withholds references changed or unpublished between the two reads',async()=>{
 rpc.mockImplementation(async name=>({data:name==='segments_for_map'?[{id:'s',version:2}]:[{id:'s',version:3,status:'approved',visibility:'public'}]}));
 expect(await fetchWatchSegments({})).toEqual([]);
});
it('reports lookup failure so the device keeps its existing offline catalogue',async()=>{
 rpc.mockResolvedValue({error:{message:'offline'}});
 await expect(fetchWatchSegments({})).rejects.toThrow('Segments unavailable');
});
