import { describe, it, expect, vi } from 'vitest';
import { createCallbackHandler, parseNativeOAuthCallback, NATIVE_AUTH_CALLBACK } from './nativeOAuth.js';

describe('native OAuth boundary', () => {
  it('rejects unrelated schemes, paths and malformed URLs', () => {
    for (const url of ['garbage', 'https://auth/callback?code=x', 'au.jpollak.journey://evil/callback?code=x', 'au.jpollak.journey://auth/other?code=x']) expect(parseNativeOAuthCallback(url)).toBeNull();
  });
  it('requires a code and rejects provider errors', () => {
    expect(() => parseNativeOAuthCallback(NATIVE_AUTH_CALLBACK)).toThrow();
    expect(() => parseNativeOAuthCallback(`${NATIVE_AUTH_CALLBACK}?error=access_denied`)).toThrow();
  });
  it('exchanges duplicate cold/warm callbacks only once', async () => {
    const exchange = vi.fn().mockResolvedValue(undefined);
    const handle = createCallbackHandler(exchange);
    const url = `${NATIVE_AUTH_CALLBACK}?code=one`;
    await Promise.all([handle(url), handle(url)]);
    await handle(url);
    expect(exchange).toHaveBeenCalledExactlyOnceWith('one');
  });
  it('allows a retry after a transient failure', async () => {
    const exchange = vi.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValueOnce(undefined);
    const handle = createCallbackHandler(exchange);
    const url = `${NATIVE_AUTH_CALLBACK}?code=retry`;
    await expect(handle(url)).rejects.toThrow('temporary');
    await handle(url);
    expect(exchange).toHaveBeenCalledTimes(2);
  });
});
