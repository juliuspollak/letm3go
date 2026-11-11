import { it,expect,vi,beforeEach } from 'vitest';
vi.mock('./cloudSync.js',()=>({syncPrivateActivities:vi.fn()}));
import { syncPrivateActivities } from './cloudSync.js';
import { sharingRequest,publishActivity,makeActivityPrivate } from './activitySharing.js';
beforeEach(()=>vi.clearAllMocks());
const owner='owner';
function client(){const q={select:()=>q,eq:()=>q,single:async()=>({data:{revision:4}}),maybeSingle:async()=>({data:{id:'trip'}})};return {auth:{getUser:vi.fn().mockResolvedValue({data:{user:{id:owner}}})},functions:{invoke:vi.fn().mockResolvedValue({data:{token:'token'}})},from:()=>q,rpc:vi.fn().mockResolvedValue({})};}
it('requires real authentication and fails when the sharing backend is unavailable',async()=>{const c=client();c.auth.getUser.mockResolvedValue({data:{user:null}});await expect(sharingRequest(c,'status','trip')).rejects.toThrow('Sign in');expect(c.functions.invoke).not.toHaveBeenCalled();c.auth.getUser.mockResolvedValue({data:{user:{id:owner}}});c.functions.invoke.mockResolvedValue({error:{}});await expect(sharingRequest(c,'publish','trip')).rejects.toThrow('could not be confirmed');});
it('backs up only the explicitly selected completed trip then publishes a revision-checked projection without photos',async()=>{const c=client(),trip={id:'trip',source:'device',endedAt:100,points:[]};syncPrivateActivities.mockResolvedValue({receipts:{trip:{owner}}});const result=await publishActivity({client:c,state:{ownerID:owner,trips:[trip,{id:'other'}],places:[{kind:'home',latitude:-34,longitude:151}],deletedIDs:['old']},id:'trip',receipts:{},checkpoint:vi.fn()});expect(syncPrivateActivities.mock.calls[0][1]).toMatchObject({trips:[trip],deletedIDs:[]});expect(c.functions.invoke).toHaveBeenCalledWith('journeys',{body:{action:'publish',id:'trip',audience:'public',revision:4,placesConfirmed:true,photoIDs:[]},timeout:20000});expect(result.token).toBe('token');});
it('rejects account mismatch and changed previews before copying GPS',async()=>{const c=client();await expect(publishActivity({client:c,state:{ownerID:'other',trips:[]},id:'trip'})).rejects.toThrow('different account');await expect(publishActivity({client:c,state:{ownerID:owner,trips:[{id:'trip',source:'device',endedAt:100,activity:'Driving',points:[]}]},id:'trip',reviewedTrip:{activity:'Walking',points:[]}})).rejects.toThrow('Activity changed');expect(syncPrivateActivities).not.toHaveBeenCalled();});
it('revokes through the owner-checked RPC and never confirms a failed revocation',async()=>{const c=client();expect(await makeActivityPrivate(c,'trip')).toEqual({audience:'private'});expect(c.rpc).toHaveBeenCalledWith('revoke_activity_publication',{p_id:'trip'});c.rpc.mockResolvedValue({error:{}});await expect(makeActivityPrivate(c,'trip')).rejects.toThrow('could not be revoked');});

it('publishes household and selected-friend audiences in one backend request',async()=>{
 const c=client(),trip={id:'trip',source:'device',endedAt:100,points:[]};
 syncPrivateActivities.mockResolvedValue({receipts:{}});
 await publishActivity({client:c,state:{ownerID:owner,trips:[trip],places:[{kind:'home',latitude:-34,longitude:151}]},id:'trip',audience:'friends',mode:'mixed',recipients:['friend1'],photoIDs:['photo1'],receipts:{},checkpoint:vi.fn()});
 expect(c.functions.invoke).toHaveBeenCalledWith('journeys',{body:{action:'publish',id:'trip',audience:'friends',revision:4,placesConfirmed:true,photoIDs:['photo1'],mode:'mixed',recipients:['friend1']},timeout:20000});
 expect(c.rpc).not.toHaveBeenCalled();
});
it('does not claim success when atomic backend publishing fails',async()=>{
 const c=client(),trip={id:'trip',source:'device',endedAt:100,points:[]};
 syncPrivateActivities.mockResolvedValue({receipts:{}});
 c.functions.invoke.mockResolvedValue({error:{message:'recipient rejected'}});
 await expect(publishActivity({client:c,state:{ownerID:owner,trips:[trip],places:[{kind:'home',latitude:-34,longitude:151}]},id:'trip',audience:'household',mode:'household',receipts:{},checkpoint:vi.fn()})).rejects.toThrow('could not be confirmed');
 expect(c.rpc).not.toHaveBeenCalled();
});
it('never publishes an unsupported private audience',async()=>{
 const c=client();
 await expect(publishActivity({client:c,state:{ownerID:owner,trips:[]},id:'trip',audience:'friends',mode:'public'})).rejects.toThrow('audience');
 expect(c.functions.invoke).not.toHaveBeenCalled();
});

it('does not publish an unmasked activity before Home is configured',async()=>{
 const c=client(),trip={id:'trip',source:'device',endedAt:100,points:[]};
 await expect(publishActivity({client:c,state:{ownerID:owner,trips:[trip],places:[]},id:'trip',receipts:{},checkpoint:vi.fn()})).rejects.toThrow('Home place');
 expect(syncPrivateActivities).not.toHaveBeenCalled();
 expect(c.functions.invoke).not.toHaveBeenCalled();
});
it('records the owner\'s decision when an activity is made private, so automatic sharing never publishes it later',async()=>{
 const c=client();c.rpc.mockResolvedValue({error:null});
 await makeActivityPrivate(c,'trip');
 expect(c.rpc).toHaveBeenCalledWith('keep_activity_private',{p_activity:'trip'});
 expect(c.rpc).toHaveBeenCalledWith('end_live_trail',{p_ref:'trip',p_hide:true});
});
it('an activity not uploaded yet is still recorded as private, by its recorder id',async()=>{
 const c=client();
 c.from=()=>({select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:null})})})})});
 c.rpc.mockResolvedValue({error:null});
 await makeActivityPrivate(c,'LOCAL-1');
 expect(c.rpc).not.toHaveBeenCalledWith('revoke_activity_publication',expect.anything());
 expect(c.rpc).toHaveBeenCalledWith('end_live_trail',{p_ref:'LOCAL-1',p_hide:true});
});
it('a failed decision is reported, never shown as success; a server without the function is fine',async()=>{
 const bad=client();
 bad.rpc.mockImplementation(async name=>name==='keep_activity_private'?{error:{message:'permission denied'}}:{error:null});
 await expect(makeActivityPrivate(bad,'trip')).rejects.toThrow(/could not be saved/);
 const c=client();
 c.rpc.mockImplementation(async name=>name==='keep_activity_private'?{error:{code:'PGRST202',message:'Could not find the function'}}:{error:null});
 expect(await makeActivityPrivate(c,'trip')).toEqual({audience:'private'});
});
it('marks an automatic publication so the server can refuse it if the activity became private',async()=>{
 const c=client();c.functions={invoke:vi.fn().mockResolvedValue({data:{token:'t'},error:null})};
 syncPrivateActivities.mockResolvedValue({receipts:{}});
 const trip={id:'trip',source:'device',endedAt:9,points:[{latitude:1,longitude:1}],activity:'Driving',details:{}};
 await publishActivity({client:c,state:{ownerID:owner,trips:[trip],places:[{kind:'home',latitude:1,longitude:1}]},id:'trip',reviewedTrip:trip,audience:'household',mode:'household',auto:true,receipts:{}});
 expect(c.functions.invoke.mock.calls.at(-1)[1].body.auto).toBe(true);
});
