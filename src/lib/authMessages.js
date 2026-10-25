export const isDiscardedRefresh=error=>error?.name==='AuthRefreshDiscardedError';
export function authMessage(error){
 if(!error||isDiscardedRefresh(error)||/refresh result discarded|session state changed mid-flight/i.test(error.message||String(error)))return '';
 if(error.status===429)return 'Too many attempts. Please wait a moment and try again.';
 if(error.code==='invalid_credentials'||/invalid login credentials/i.test(error.message||''))return 'Email or password is incorrect.';
 if(error.code==='email_not_confirmed')return 'Please confirm your email before signing in.';
 return 'We couldn’t complete sign-in. Please try again. Your saved journeys are safe on this device.';
}
