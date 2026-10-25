import {it,expect} from 'vitest';
import {authMessage} from './authMessages.js';
it('keeps internal SDK races and diagnostics out of the sign-in screen',()=>{expect(authMessage({name:'AuthRefreshDiscardedError',message:'Refresh result discarded: session state changed mid-flight'})).toBe('');expect(authMessage({message:'Internal SQL/keychain/native diagnostic details'})).not.toContain('diagnostic');expect(authMessage({code:'invalid_credentials'})).toBe('Email or password is incorrect.');});
