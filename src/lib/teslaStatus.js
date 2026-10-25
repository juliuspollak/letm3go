export const teslaConnected=status=>status?.connected===true||status?.status==='connected';
export function teslaLocationLabel(status){
 if(!status)return 'Not verified';
 if(!teslaConnected(status))return 'Not connected';
 if(status.locationAccess===true)return 'Enabled';if(status.locationAccess===false)return 'Not enabled';
 if(Array.isArray(status.grantedScopes))return status.grantedScopes.includes('vehicle_location')?'Enabled':'Not enabled';
 return 'Not verified';
}
