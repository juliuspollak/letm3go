import { it,expect,vi,beforeEach } from 'vitest';
vi.mock('./cloudSync.js',()=>({syncPrivateActivities:vi.fn()}));
import { syncPrivateActivities } from './cloudSync.js';
import { sharingRequest,publishActivity,makeActivityPrivate } from './activitySharing.js';
beforeEach(()=>vi.clearAllMocks());
const owner='owner';
function client(){const q={select:()=>q,eq:()=>q,single:async()=>({data:{revision:4}}),maybeSingle:async()=>({data:{id:'trip'}})};return {auth:{getUser:vi.fn().mockResolvedValue({data:{user:{id:owner}}})},functions:{invoke:vi.fn().mockResolvedValue({data:{token:'token'}})},from:()=>q,rpc:vi.fn().mockResolvedValue({})};}
it('requires real authentication and fails when the sharing backend is unavailable',async()=>{const c=client();c.auth.getUser.mockResolvedValue({data:{user:null}});await expect(sharingRequest(c,'status','trip')).rejects.toThrow('Sign in');expect(c.functions.invoke).not.toHaveBeenCalled();c.auth.getUser.mockResolvedValue({data:{user:{id:owner}}});c.functions.invoke.mockResolvedValue({error:{}});await expect(sharingRequest(c,'publish','trip')).rejects.toThrow('could not be confirmed');});
it('backs up only the explicitly selected completed trip then publishes a revision-checked projection without photos',async()=>{const c=client(),trip={id:'trip',source:'device',endedAt:100,points:[]};syncPrivateActivities.mockResolvedValue({receipts:{trip:{owner}}});const result=await publishActivity({client:c,state:{ownerID:owner,trips:[trip,{id:'other'}],places:[],deletedIDs:['old']},id:'trip',receipts:{},checkpoint:vi.fn()});expect(syncPrivateActivities.mock.calls[0][1]).toMatchObject({trips:[trip],deletedIDs:[]});expect(c.functions.invoke).toHaveBeenCalledWith('journeys',{body:{action:'publish',id:'trip',audience:'public',revision:4,placesConfirmed:true,photoIDs:[]},timeout:20000});expect(result.token).toBe('token');});
it('rejects account mismatch and changed previews before copying GPS',async()=>{const c=client();await expect(publishActivity({client:c,state:{ownerID:'other',trips:[]},id:'trip'})).rejects.toThrow('different account');await expect(publishActivity({client:c,state:{ownerID:owner,trips:[{id:'trip',source:'device',endedAt:100,activity:'Driving',points:[]}]},id:'trip',reviewedTrip:{activity:'Walking',points:[]}})).rejects.toThrow('Activity changed');expect(syncPrivateActivities).not.toHaveBeenCalled();});
it('revokes through the owner-checked RPC and never confirms a failed revocation',async()=>{const c=client();expect(await makeActivityPrivate(c,'trip')).toEqual({audience:'private'});expect(c.rpc).toHaveBeenCalledWith('revoke_activity_publication',{p_id:'trip'});c.rpc.mockResolvedValue({error:{}});await expect(makeActivityPrivate(c,'trip')).rejects.toThrow('could not be revoked');});

it('publishes household and selected-friend audiences only after server permission confirmation',async()=>{
 const c=client(),trip={id:'trip',source:'device',endedAt:100,points:[]};
 syncPrivateActivities.mockResolvedValue({receipts:{}});
 c.functions.invoke.mockImplementation(async(_,{body})=>({data:body.action==='status'?{audience:'private'}:{token:'token'}}));
 await publishActivity({client:c,state:{ownerID:owner,trips:[trip]},id:'trip',audience:'friends',mode:'mixed',recipients:['friend1'],photoIDs:['photo1'],receipts:{},checkpoint:vi.fn()});
 expect(c.functions.invoke).toHaveBeenCalledWith('journeys',{body:{action:'publish',id:'trip',audience:'friends',revision:4,placesConfirmed:true,photoIDs:['photo1']},timeout:20000});
 expect(c.rpc).toHaveBeenCalledWith('configure_social_journey',{p_activity:'trip',p_mode:'mixed',p_recipients:['friend1']});
 expect(c.rpc).not.toHaveBeenCalledWith('prepare_social_journey',expect.anything());
});
it('revokes an incomplete social publication when recipient authorisation fails',async()=>{
 const c=client(),trip={id:'trip',source:'device',endedAt:100,points:[]};
 syncPrivateActivities.mockResolvedValue({receipts:{}});
 c.functions.invoke.mockImplementation(async(_,{body})=>({data:body.action==='status'?{audience:'private'}:{token:'token'}}));
 c.rpc.mockImplementation(async name=>name==='configure_social_journey'?{error:{message:'not authorised'}}:{});
 await expect(publishActivity({client:c,state:{ownerID:owner,trips:[trip]},id:'trip',audience:'household',mode:'household',receipts:{},checkpoint:vi.fn()})).rejects.toThrow('recipients');
 expect(c.rpc).toHaveBeenCalledWith('revoke_activity_publication',{p_id:'trip'});
});
it('never publishes an unsupported private audience',async()=>{
 const c=client();
 await expect(publishActivity({client:c,state:{ownerID:owner,trips:[]},id:'trip',audience:'friends',mode:'public'})).rejects.toThrow('audience');
 expect(c.functions.invoke).not.toHaveBeenCalled();
});
