export const NATIVE_AUTH_CALLBACK = 'au.jpollak.journey://auth/callback';

export function parseNativeOAuthCallback(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'au.jpollak.journey:' || url.hostname !== 'auth' || url.pathname !== '/callback' || url.username || url.password || url.port) return null;
    const error = url.searchParams.get('error_description') || url.searchParams.get('error');
    if (error) throw new Error('Apple sign-in was cancelled or rejected. Please try again.');
    const code = url.searchParams.get('code');
    if (!code) throw new Error('The sign-in callback is missing its authorization code.');
    return code;
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

// Both cold launch and appUrlOpen can deliver the same one-use authorization code.
export function createCallbackHandler(exchange) {
  const completed = new Set();
  const pending = new Map();
  return function handle(value) {
    const code = parseNativeOAuthCallback(value);
    if (!code || completed.has(code)) return Promise.resolve();
    if (pending.has(code)) return pending.get(code);
    const result = Promise.resolve().then(() => exchange(code)).then(() => {
      completed.add(code);
      if (completed.size > 32) completed.delete(completed.values().next().value);
    }).finally(() => pending.delete(code));
    pending.set(code, result);
    return result;
  };
}
