// Words for the native recording-health report. Native decides the status and the
// order of the issues from what iOS reports right now, so the Home screen and the
// diagnostic log can never disagree. Nothing here reads or remembers a permission.
const settings={label:'Open Settings',run:['openSettings']};
export const HEALTH_LABELS={checking:'Checking',ready:'Ready',limited:'Limited',unavailable:'Unavailable'};
export const RECORDING_ISSUES={
 accountNotReady:{title:'Automatic Recording Is Unavailable',message:'Private activity storage is not open on this iPhone yet. Automatic recording starts once it is.'},
 locationServicesOff:{title:'Automatic Recording Is Unavailable',message:'Location Services are turned off on this iPhone, so Letm3go cannot record journeys automatically. Turn them on in iOS Settings under Privacy & Security.',action:settings},
 locationDenied:{title:'Automatic Recording Is Unavailable',message:'Letm3go does not have Location access, so journeys cannot be recorded automatically.',action:settings},
 locationRestricted:{title:'Automatic Recording Is Unavailable',message:'Location access is restricted on this iPhone, for example by Screen Time or device management, so journeys cannot be recorded automatically.',action:settings},
 locationNotRequested:{title:'Automatic Recording Is Unavailable',message:'Letm3go has not been given Location access yet, so journeys cannot be recorded automatically.',action:{label:'Allow Location',run:['requestPermission',true]}},
 automaticOff:{title:'Automatic Recording Is Off',message:'Automatic Tracking is switched off, so journeys are only recorded when you start them yourself.',action:{label:'Turn On',run:['setAutomatic',true]}},
 servicesNotRunning:{title:'Automatic Recording Is Not Running',message:'Your settings allow automatic recording, but its location services have not been started. Reopening Letm3go usually starts them. If this stays, share the Diagnostic Log.'},
 monitoringFailed:{title:'Automatic Recording May Miss Departures',message:'iOS reported a problem with location monitoring, so a departure may not wake Letm3go. Reopening the app tries again. If this stays, share the Diagnostic Log.'},
 servicesUnsupported:{title:'Automatic Recording Is Limited',message:'iOS reports that this iPhone cannot currently use the location monitoring Letm3go relies on to notice a departure.'},
 locationWhileUsing:{title:'Automatic Recording Is Limited',message:'Letm3go needs Always Allow Location access to automatically detect and record your journeys when the app is in the background.\n\nYour current setting is While Using the App, so drives, walks and other activities may not be recorded unless the app is open.',action:settings},
 preciseOff:{title:'Journey Tracking May Be Less Accurate',message:'Precise Location is off, so routes may be less accurate and some departures may be noticed late.',action:settings},
 motionDenied:{title:'Activity Detection Is Limited',message:'Letm3go cannot use Motion & Fitness. Journeys can still be detected from location, but departures may be noticed later and walking and driving may be harder to tell apart.',action:settings},
 motionNotRequested:{title:'Allow Motion & Fitness',message:'Letm3go has not asked for Motion & Fitness yet. Journeys can still be detected from location, but with it departures are noticed sooner and walking and driving are easier to tell apart.',action:{label:'Allow Motion & Fitness',run:['requestMotionPermission']}},
 motionUnavailable:{title:'Activity Detection Is Limited',message:'Motion activity is not available on this device. Journeys can still be detected from location, but departures may be noticed later and walking and driving may be harder to tell apart.'},
 backgroundRefreshOff:{title:'Background Recording May Be Limited',message:'Background App Refresh is off for Letm3go. Some iOS location features can still work, but iOS may not reopen the app after it has been closed, so a departure could be missed.',action:settings}
};
const LOCATION={always:'Always',whenInUse:'While Using the App',denied:'Denied',restricted:'Restricted',notDetermined:'Not requested'};
const MOTION={authorized:'Allowed',denied:'Denied',restricted:'Restricted',notDetermined:'Not requested',unavailable:'Unavailable'};
const REFRESH={available:'On',denied:'Off',restricted:'Restricted'};
const SERVICES={registered:'Requested · iOS holds a place wake-up',requested:'Requested from iOS',notRequested:'Not requested',failed:'iOS reported a problem',unsupported:'Not supported'};
export const healthRows=health=>[
 ['Automatic Tracking',health.automaticEnabled?'On':'Off'],
 ['Location Services',health.locationServices?'On':'Off'],
 ['Location access',LOCATION[health.location]||health.location||'Not reported'],
 ['Precise Location',health.precise?'On':'Off'],
 ['Motion & Fitness',MOTION[health.motion]||health.motion||'Not reported'],
 ['Background App Refresh',REFRESH[health.backgroundRefresh]||health.backgroundRefresh||'Not reported'],
 ['Permissions',HEALTH_LABELS[health.permissions]||'Not reported'],
 ['Recording services',SERVICES[health.services]||'Not reported']
];
// Lesser problems wait on Home; these are worth showing wherever the app opens.
const LOCAL_ONLY=new Set(['preciseOff','motionDenied','motionNotRequested','motionUnavailable','backgroundRefreshOff']);
export function warningIssue(health,{tab,recording,dismissed}={}){
 const issue=healthIssues(health)[0];
 if(!issue||recording||issue.code===dismissed)return null;
 return tab==='Home'||!LOCAL_ONLY.has(issue.code)?issue:null;
}
export const healthIssues=health=>(health?.issues||[]).map(code=>({code,...(RECORDING_ISSUES[code]||{title:'Recording may be limited',message:code})}));
