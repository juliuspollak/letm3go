import { webcrypto } from 'node:crypto';
import { expect, it } from 'vitest';
import { openCredentials, sealCredentials } from '../../supabase/functions/_shared/credentialCrypto.js';
it('authenticates encrypted provider credentials against both user and provider',async()=>{
 const key=btoa('a'.repeat(32)),value={refresh_token:'not-a-real-token'};const sealed=await sealCredentials(value,key,'owner','tesla',webcrypto);
 expect(sealed).not.toContain(value.refresh_token);expect(await openCredentials(sealed,key,'owner','tesla',webcrypto)).toEqual(value);
 await expect(openCredentials(sealed,key,'other','tesla',webcrypto)).rejects.toThrow();await expect(openCredentials(sealed,key,'owner','apple',webcrypto)).rejects.toThrow();
});
