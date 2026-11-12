import {describe,expect,it,vi} from 'vitest';
import {readHistorySharing,runHistoryBackfill,setHistorySharing} from './historySharing.js';

const client=responses=>({functions:{invoke:vi.fn(async()=>({data:responses.shift()??{published:0,failed:0,remaining:0},error:null}))},rpc:vi.fn(async()=>({data:null,error:null}))});

describe('sharing earlier activities',()=>{
 it('asks the function in rounds until nothing is left, reporting progress',async()=>{
  const c=client([{published:5,failed:0,remaining:7},{published:5,failed:0,remaining:2},{published:2,failed:0,remaining:0}]);
  const progress=[];
  const result=await runHistoryBackfill({client:c,onProgress:p=>progress.push(p)});
  expect(result).toEqual({published:12,failed:0,remaining:0,needsHome:false});
  expect(c.functions.invoke).toHaveBeenCalledTimes(3);
  expect(c.functions.invoke).toHaveBeenCalledWith('journeys',expect.objectContaining({body:{action:'backfillHistory'}}));
  expect(progress.at(-1)).toEqual({published:12,remaining:0});
 });
 it('stops, rather than loops, when a round publishes nothing (what is left cannot be shared now)',async()=>{
  const c=client([{published:2,failed:0,remaining:3},{published:0,failed:3,remaining:3},{published:9,failed:0,remaining:0}]);
  const result=await runHistoryBackfill({client:c});
  expect(c.functions.invoke).toHaveBeenCalledTimes(2);
  expect(result).toMatchObject({published:2,failed:3,remaining:3});
 });
 it('says a Home place is needed, and publishes nothing',async()=>{
  const c=client([{published:0,failed:0,remaining:97,needsHome:true}]);
  expect(await runHistoryBackfill({client:c})).toMatchObject({needsHome:true,published:0,remaining:97});
  expect(c.functions.invoke).toHaveBeenCalledTimes(1);
 });
 it('fails clearly when the function refuses or is not there',async()=>{
  await expect(runHistoryBackfill({client:client([{error:'Sharing earlier activities has not been switched on'}])})).rejects.toThrow(/not been switched on/);
  const down={functions:{invoke:async()=>({data:null,error:{message:'x'}})}};
  await expect(runHistoryBackfill({client:down})).rejects.toThrow(/could not be completed/);
 });
 it('reads and changes the consent through the database only',async()=>{
  const c={rpc:vi.fn(async name=>name==='my_history_sharing'?{data:{enabled:true,waiting:4},error:null}:{data:null,error:null})};
  expect(await readHistorySharing(c)).toEqual({enabled:true,waiting:4});
  await setHistorySharing(c,true);
  expect(c.rpc).toHaveBeenCalledWith('set_history_sharing',{p_enabled:true});
  expect(await readHistorySharing({rpc:async()=>({data:null,error:{code:'PGRST202'}})})).toBeNull(); // not deployed yet: hidden
  await expect(setHistorySharing({rpc:async()=>({error:{message:'x'}})},true)).rejects.toThrow(/Could not change/);
 });
});
