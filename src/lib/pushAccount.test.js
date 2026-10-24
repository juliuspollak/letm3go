import { afterEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({persist:null,owner:'A',getUser:vi.fn(),rpc:vi.fn(),dispose:vi.fn(),unregister:vi.fn(),removeAll:vi.fn()}));
vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:()=>true}}));
vi.mock('@capacitor/push-notifications',()=>({PushNotifications:{unregister:mocks.unregister,removeAllDeliveredNotifications:mocks.removeAll}}));
vi.mock('./supabase.js',()=>({supabase:{auth:{getUser:mocks.getUser},rpc:mocks.rpc}}));
vi.mock('./nativeNotifications.js',()=>({enableNativePush:async({persistToken})=>{mocks.persist=persistToken;return {enabled:true,dispose:mocks.dispose};}}));
import { enableAccountPush, stopAccountPush } from './pushAccount.js';
afterEach(async()=>{await stopAccountPush();localStorage.clear();});
it('registers tokens with a server-checked expected owner',async()=>{
 mocks.getUser.mockResolvedValue({data:{user:{id:'A'}}});mocks.rpc.mockResolvedValue({error:null});await enableAccountPush('A',vi.fn());await mocks.persist({token:'synthetic-token',environment:'sandbox'});
 expect(mocks.rpc).toHaveBeenCalledWith('register_push_device',expect.objectContaining({p_owner:'A',p_token:'synthetic-token',p_environment:'sandbox'}));
});
it('ignores late token callbacks after logout or an account change',async()=>{
 mocks.getUser.mockResolvedValue({data:{user:{id:'A'}}});mocks.rpc.mockResolvedValue({error:null});await enableAccountPush('A',vi.fn());const old=mocks.persist;
 await stopAccountPush();mocks.rpc.mockClear();await old({token:'old-token',environment:'sandbox'});expect(mocks.rpc).not.toHaveBeenCalled();
 await enableAccountPush('B',vi.fn());await old({token:'old-token',environment:'sandbox'});expect(mocks.rpc).not.toHaveBeenCalled();
});
