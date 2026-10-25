import { webcrypto } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { freshTeslaCredentials, withTeslaLease, teslaLocationAccess } from '../../supabase/functions/_shared/teslaCredentials.js';
import { sealCredentials, openCredentials } from '../../supabase/functions/_shared/credentialCrypto.js';
const key=Buffer.alloc(32,7).toString('base64');
async function fixture(value){const row={ciphertext:await sealCredentials(value,key,'owner','tesla',webcrypto)};const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:row})};return {from:()=>query,rpc:vi.fn().mockResolvedValue({data:'lease'})};}
it('refreshes expired access and durably saves encrypted rotated credentials before returning',async()=>{
 const admin=await fixture({access_token:'old',refresh_token:'refresh',expires_at:0,vehicles:[{teslaID:'own'}]});
 const fetchImpl=vi.fn().mockResolvedValue({ok:true,json:async()=>({access_token:'new',refresh_token:'rotated',expires_in:3600})});
 const result=await freshTeslaCredentials(admin,'owner','lease',key,'client',{fetchImpl,cryptoImpl:webcrypto,now:1000});
 expect(result.access_token).toBe('new');expect(result.vehicles).toEqual([{teslaID:'own'}]);
 const [name,args]=admin.rpc.mock.calls[0];expect(name).toBe('save_tesla_credentials');expect(args.p_owner).toBe('owner');expect(args.p_lease).toBe('lease');expect(args.p_ciphertext).not.toContain('rotated');
 expect((await openCredentials(args.p_ciphertext,key,'owner','tesla',webcrypto)).refresh_token).toBe('rotated');
 await expect(openCredentials(args.p_ciphertext,key,'other','tesla',webcrypto)).rejects.toThrow();
 admin.rpc.mockResolvedValue({error:{message:'failed'}});
 await expect(freshTeslaCredentials(admin,'owner','lease',key,'client',{fetchImpl,cryptoImpl:webcrypto,now:1000})).rejects.toThrow('could not be saved');
});
it('reuses valid access without contacting Tesla',async()=>{const admin=await fixture({access_token:'valid',expires_at:999999});const fetchImpl=vi.fn();expect((await freshTeslaCredentials(admin,'owner','lease',key,'client',{fetchImpl,cryptoImpl:webcrypto,now:1000})).access_token).toBe('valid');expect(fetchImpl).not.toHaveBeenCalled();});
it('does not start concurrent operations and releases the lease after failure',async()=>{const admin={rpc:vi.fn().mockResolvedValue({data:null})};const operation=vi.fn();await expect(withTeslaLease(admin,'owner',operation)).rejects.toThrow('in progress');expect(operation).not.toHaveBeenCalled();admin.rpc.mockResolvedValue({data:'lease'});await expect(withTeslaLease(admin,'owner',async()=>{throw new Error('offline');})).rejects.toThrow('offline');expect(admin.rpc).toHaveBeenLastCalledWith('release_tesla_token_lease',{p_owner:'owner',p_lease:'lease'});});

it('reports only provider-returned vehicle location scope and leaves unknown grants unverified',()=>{
 expect(teslaLocationAccess({scope:'openid offline_access vehicle_location'})).toBe(true);
 expect(teslaLocationAccess({scope:'openid vehicle_device_data'})).toBe(false);
 expect(teslaLocationAccess({locationConsent:true})).toBeNull();
 expect(teslaLocationAccess({scope:''})).toBeNull();
 expect(teslaLocationAccess({scope:'not_vehicle_location'})).toBe(false);
});
