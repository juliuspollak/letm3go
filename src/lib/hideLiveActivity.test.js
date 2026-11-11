import {beforeEach,expect,it,vi} from 'vitest';
import {flushPendingHides,hideLiveActivity,hideStatus,isLiveHidden} from './hideLiveActivity.js';

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
it('a phone failure is reported and not claimed as stopped, but the server is still told (or queued) so the activity stays private',async()=>{
 const recorder={hideLiveTrail:vi.fn().mockRejectedValue(new Error('plugin missing'))},client={rpc:vi.fn().mockResolvedValue(ok)};
 await expect(hideLiveActivity('A-4',{recorder,client})).rejects.toThrow('plugin missing');
 expect(client.rpc).toHaveBeenCalledWith('end_live_trail',{p_ref:'A-4',p_hide:true});
 expect(isLiveHidden('A-4')).toBe(false);                          // the phone did not stop, so that is not claimed
 const offline={rpc:vi.fn().mockResolvedValue(bad)};
 await expect(hideLiveActivity('A-5',{recorder,client:offline})).rejects.toThrow();
 client.rpc.mockClear();await flushPendingHides(client);           // queued, and delivered when the server is reachable
 expect(client.rpc).toHaveBeenCalledWith('end_live_trail',{p_ref:'A-5',p_hide:true});
});
it('a hide added while a flush is waiting on the network is not lost',async()=>{
 const recorder={hideLiveTrail:vi.fn().mockResolvedValue()};
 const client={rpc:vi.fn().mockResolvedValue(bad)};
 await hideLiveActivity('OLD-1',{recorder,client});
 let release;
 client.rpc.mockImplementationOnce(()=>new Promise(r=>{release=()=>r(ok);}));   // the flush of OLD-1 is slow
 const flushing=flushPendingHides(client);
 client.rpc.mockResolvedValue(bad);
 await hideLiveActivity('NEW-2',{recorder,client});                            // fails: pending
 release();await flushing;
 client.rpc.mockClear();client.rpc.mockResolvedValue(ok);
 await flushPendingHides(client);
 expect(client.rpc).toHaveBeenCalledWith('end_live_trail',{p_ref:'NEW-2',p_hide:true});
 expect(client.rpc).not.toHaveBeenCalledWith('end_live_trail',{p_ref:'OLD-1',p_hide:true});
});
it('reports none, pending and confirmed honestly',async()=>{
 const recorder={hideLiveTrail:vi.fn().mockResolvedValue()},client={rpc:vi.fn().mockResolvedValue(bad)};
 expect(hideStatus('S-1')).toBe('none');
 await hideLiveActivity('S-1',{recorder,client});
 expect(hideStatus('S-1')).toBe('pending');
 client.rpc.mockResolvedValue(ok);await flushPendingHides(client);
 expect(hideStatus('S-1')).toBe('confirmed');
});
