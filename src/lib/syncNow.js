// Ask AutoCloudSync for a full pass now (the Segments view's Retry now).
export const SYNC_NOW_EVENT='letm3go:sync-now';
export const requestSync=()=>window.dispatchEvent(new Event(SYNC_NOW_EVENT));
