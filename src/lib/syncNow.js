// Ask AutoCloudSync for a full pass now (the Segments view's Retry now).
export const SYNC_NOW_EVENT='letm3go:sync-now';
// An activity reached the cloud: whatever publishes it onward (household sharing) can look again now.
export const BACKED_UP_EVENT='letm3go:backed-up';
export const requestSync=()=>window.dispatchEvent(new Event(SYNC_NOW_EVENT));
