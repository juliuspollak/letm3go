import { expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({getUser:vi.fn(),invoke:vi.fn(),open:vi.fn()}));
vi.mock('./config.js',()=>({config:{teslaEnabled:true}}));
vi.mock('./supabase.js',()=>({supabase:{auth:{getUser:mocks.getUser},functions:{invoke:mocks.invoke}}}));
vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:()=>true}}));
vi.mock('@capacitor/browser',()=>({Browser:{open:mocks.open}}));
import { teslaRequest, openTeslaURL } from './tesla.js';
it('requires Letm3go authentication before starting a Tesla connection',async()=>{
 mocks.getUser.mockResolvedValue({data:{user:null}});await expect(teslaRequest('authorize')).rejects.toThrow('Sign in');expect(mocks.invoke).not.toHaveBeenCalled();
});
it('opens only official HTTPS Tesla consent URLs',async()=>{
 await expect(openTeslaURL('https://attacker.example/oauth2/v3/authorize')).rejects.toThrow();await expect(openTeslaURL('http://auth.tesla.com/oauth2/v3/authorize')).rejects.toThrow();
 await openTeslaURL('https://auth.tesla.com/oauth2/v3/authorize?state=test');expect(mocks.open).toHaveBeenCalledWith({url:'https://auth.tesla.com/oauth2/v3/authorize?state=test'});
});
