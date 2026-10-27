// Account settings that used to exist only in the device-encrypted preferences
// file. Vehicles and sync receipts are deliberately excluded: the Collection has
// its own table, and receipts are per-device bookkeeping.
const DISTANCE_UNITS=['km','mi'];
const stringList=(value,limit)=>Array.isArray(value)?value.filter(entry=>typeof entry==='string'&&entry.length<=100).slice(0,limit):[];

export function settingsPayload(preferences={}){
 const payload={};
 const name=typeof preferences.displayName==='string'?preferences.displayName.trim():'';
 if(name)payload.displayName=name.slice(0,100);
 if(typeof preferences.avatar==='string'&&preferences.avatar)payload.avatar=preferences.avatar;
 if(DISTANCE_UNITS.includes(preferences.distanceUnit))payload.distanceUnit=preferences.distanceUnit;
 payload.notificationsEnabled=preferences.notificationsEnabled===true;
 payload.bookmarks=stringList(preferences.bookmarks,1000);
 payload.archivedTrips=stringList(preferences.archivedTrips,2000);
 if(typeof preferences.journeyGrouping==='string'&&preferences.journeyGrouping)payload.journeyGrouping=preferences.journeyGrouping.slice(0,300000);
 return payload;
}

// Additive merge used by an explicit restore. A local value is never replaced by
// an empty one, favourites and archived trips are unioned, and the device keeps
// its own notification permission.
export function mergeRestoredSettings(preferences={},payload={}){
 const patch={};
 if(!preferences.displayName&&typeof payload.displayName==='string'&&payload.displayName.trim())patch.displayName=payload.displayName.trim().slice(0,100);
 if(!preferences.avatar&&typeof payload.avatar==='string'&&/^data:image\/(?:jpeg|png);base64,/.test(payload.avatar))patch.avatar=payload.avatar;
 if(DISTANCE_UNITS.includes(payload.distanceUnit)&&payload.distanceUnit!==preferences.distanceUnit)patch.distanceUnit=payload.distanceUnit;
 const bookmarks=[...new Set([...(preferences.bookmarks||[]),...stringList(payload.bookmarks,1000)])];
 if(bookmarks.length>(preferences.bookmarks||[]).length)patch.bookmarks=bookmarks.slice(0,1000);
 const archived=[...new Set([...(preferences.archivedTrips||[]),...stringList(payload.archivedTrips,2000)])];
 if(archived.length>(preferences.archivedTrips||[]).length)patch.archivedTrips=archived.slice(0,2000);
 if(!preferences.journeyGrouping&&typeof payload.journeyGrouping==='string'&&payload.journeyGrouping)patch.journeyGrouping=payload.journeyGrouping;
 return patch;
}

async function sha256(cryptoImpl,value){
 const bytes=new TextEncoder().encode(value);
 return Array.from(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
}

export async function syncAccountSettings(client,{owner,preferences,receipts={}},{checkpoint=async()=>{},cryptoImpl=crypto}={}){
 if(!owner)throw new Error('Sign in before backing up your settings.');
 if(!cryptoImpl?.subtle)throw new Error('Secure backup hashing is unavailable on this device.');
 const payload=settingsPayload(preferences||{});
 const fingerprint=await sha256(cryptoImpl,JSON.stringify(payload));
 const previous=receipts.settings;
 if(previous&&previous.owner!==owner)throw new Error('Settings backup belongs to another account.');
 if(previous?.fingerprint===fingerprint)return {receipts,uploaded:0};
 const {data:revision,error}=await client.rpc('backup_account_settings',{p_owner:owner,p_payload:payload,p_fingerprint:fingerprint,p_expected_revision:previous?.revision??null});
 if(error||!Number.isInteger(revision))throw new Error('Settings backup needs the approved backend migration, or these settings changed in the cloud. Nothing on this device was changed.');
 await checkpoint({...receipts,settings:{owner,fingerprint,revision}});
 return {receipts:{...receipts,settings:{owner,fingerprint,revision}},uploaded:1};
}
