import {supabase} from './supabase.js';

export async function requestSharedLocations(ownerIDs,client=supabase){
 if(!ownerIDs.length)return 0;
 if(!client)throw new Error('Location refresh is unavailable.');
 const {data,error}=await client.rpc('request_location_refresh',{p_owners:ownerIDs});
 if(error)throw error;
 return data;
}

export function refreshLabel(person,attempt){
 const previous=attempt?.baseline.get(person.userId);
 if(!previous||person.state==='off')return '';
 if(previous.group===person.group&&Number.isFinite(person.locationAt)&&person.locationAt>(previous.locationAt??-Infinity))return 'New location';
 if(attempt.pending)return 'Refreshing…';
 if(attempt.requestFailed)return 'Request failed';
 if(attempt.readFailed[person.group])return 'Couldn’t check';
 return 'No new location';
}
