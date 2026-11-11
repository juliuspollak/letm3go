import {beforeEach,expect,it,vi} from 'vitest';
import {flushPendingHides,hideLiveActivity,isLiveHidden} from './hideLiveActivity.js';

beforeEach(()=>localStorage.clear());
const ok={data:null,error:null},bad={data:null,error:{message:'offline'}};

it('stops the phone first, remembers the choice, and tells the server',async()=>{
 const recorder={hideLiveTrail:vi.fn().mockResolvedValue()},client={rpc:vi.fn().mockResolvedValue(ok)};
 await hideLiveActivity('A-1',{recorder,client});
 expect(recorder.hideLiveTrail).toHaveBeenCalledWith('A-1');
 expect(client.rpc).toHaveBeenCalledWith('end_live_trail',{p_ref:'A-1',p_hide:true});
 expect(isLiveHidden('a-1')).toBe(true);
});
it('a server that answers with an error (supabase does not throw) is retried later, not forgotten',async()=>{
 const recorder={hideLiveTrail:vi.fn().mockResolvedValue()},client={rpc:vi.fn().mockResolvedValue(bad)};
 await hideLiveActivity('A-2',{recorder,client});
 expect(client.rpc).toHaveBeenCalledTimes(1);
 client.rpc.mockResolvedValue(bad);await flushPendingHides(client);          // still offline
 expect(client.rpc).toHaveBeenCalledTimes(2);
 client.rpc.mockResolvedValue(ok);await flushPendingHides(client);           // back online
 expect(client.rpc).toHaveBeenCalledTimes(3);
 client.rpc.mockClear();await flushPendingHides(client);                    // nothing left to tell
 expect(client.rpc).not.toHaveBeenCalled();
});
it('an exception from the server is treated the same way',async()=>{
 const recorder={hideLiveTrail:vi.fn().mockResolvedValue()},client={rpc:vi.fn().mockRejectedValue(new Error('x'))};
 await hideLiveActivity('A-3',{recorder,client});
 client.rpc.mockResolvedValue(ok);await flushPendingHides(client);
 expect(client.rpc).toHaveBeenLastCalledWith('end_live_trail',{p_ref:'A-3',p_hide:true});
});
it('fails (and remembers nothing) when the phone cannot be told',async()=>{
 const recorder={hideLiveTrail:vi.fn().mockRejectedValue(new Error('x'))};
 await expect(hideLiveActivity('A-4',{recorder,client:null})).rejects.toThrow();
 expect(isLiveHidden('A-4')).toBe(false);
});
