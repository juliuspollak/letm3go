// Tracking & Permissions rows for passive rest and Home Wi-Fi. States, reasons,
// times and counts only: never a network name, access point or coordinate.
import {duration} from './adaptiveDiagnostics.js';

export const WIFI_MATCH_LABELS={
 matched:'Home Wi-Fi detected',
 notMatched:'Connected to another network',
 unavailable:'Wi-Fi unavailable',
 unknown:'Waiting for fresh Wi-Fi evidence',
 notConfigured:'Not configured'
};
export const WIFI_HELP={
 notMatched:'Join your Home network if you are at Home.',
 unavailable:'iOS reported no network: Wi-Fi may be off or disconnected, or Precise Location may be off.',
 unknown:'Reopen the app at Home to read it again.'
};
export const SERVICE_SESSION_LABELS={
 held:'Held (started with the app open)',
 rejoined:'Held (rejoined after relaunch)',
 heldFromBackground:'Held (created in the background; replaced next time the app is opened)',
 none:'Not held',
 unsupported:'Unavailable before iOS 18'
};
// What can bring location back without a background session. Armed is a request
// iOS accepted, never proof that a departure will be caught.
export const RECOVERY_LABELS={
 notNeeded:'Not needed · the background location session is held',
 armed:'Wake-ups armed · not proof that a departure will be caught',
 limited:'Limited',
 unavailable:'Unavailable'
};
export const RECOVERY_ISSUES={
 alwaysAccessMissing:'needs Always location access',
 noWakeUps:'no exit region, significant-change or visit wake-up is running',
 regionMonitoringFailed:'iOS reported a region monitoring failure',
 exitRegionMissing:'this place has no exit region',
 significantChangesOff:'significant-change monitoring is off',
 visitsOff:'visit monitoring is off',
 serviceSessionMissing:'no Always service session, so precise GPS after a wake-up cannot keep the app running',
 serviceSessionInsufficient:'iOS reports the app is not sufficiently in use to resume it',
 keepAliveNotRunning:'the keep-alive that lets iOS resume the app is not running'
};
const WAKE_OUTCOMES={preciseFix:'a precise fix followed the last wake-up',noPreciseFix:'the last wake-up check ended without a precise fix',interrupted:'the last wake-up check was interrupted before a precise fix',unknown:'the last wake-up outcome is unknown; the check ended while the app was not running'};
const time=value=>Number.isFinite(value)&&value>0?new Date(value*1000).toLocaleTimeString():'Never';

export function passiveRows(state){
 const passive=state?.passiveRest;
 if(!passive)return [];
 const wifi=passive.wifi||{};
 const modes=passive.modeSeconds||{};
 const latency=state.adaptive?.lastDepartureLatency||{};
 const modeSummary=['precise','standby','resting','passive','stationary'].filter(mode=>modes[mode]>0).map(mode=>`${mode} ${duration(modes[mode])}`).join(' · ');
 return [
  ['Release location while resting',passive.enabled?(passive.supported?'On':'On · needs iOS 18; the background session stays held'):'Off · background session stays held'],
  ['Confirmed rest (needed for passive rest)',passive.restConfirmed?`Confirmed · ${passive.restReason}`:passive.restReason||'Not confirmed'],
  ['Reduced-accuracy rest',passive.reducedAccuracyRest?(passive.reducedAccuracyRest.active?`Active at the ${passive.reducedAccuracyRest.place==='savedHome'?'saved Home':'current place'} · 100 m location, background session kept`:'Not active'):'Not reported'],
  ['Passive rest',passive.active?`Active since ${time(passive.since)} · no location updates, no background session`:`Not active · ${passive.retainReason||'waiting'}`],
  ['Always service session',SERVICE_SESSION_LABELS[passive.serviceSession]||passive.serviceSession||'Not reported'],
  ['Sharing while resting',passive.sharingRest?`${passive.sharingRest.enabled?'Device test on':'Off'} · ${passive.sharingRest.sharingHoldsLocation?'sharing keeps continuous location':'sharing does not hold location'} · ${passive.sharingRest.reason}${passive.sharingRest.decisionCurrent===false?' · sharing changed since; deciding again':''}`:'Not reported'],
  ['Background recovery',passive.backgroundRecovery?[RECOVERY_LABELS[passive.backgroundRecovery.status]||passive.backgroundRecovery.status,...(passive.backgroundRecovery.issues||[]).map(issue=>RECOVERY_ISSUES[issue]||issue),WAKE_OUTCOMES[passive.backgroundRecovery.lastWakeOutcome]].filter(Boolean).join(' · '):'Not reported'],
  ['False wake-ups restored this hour',String(passive.falseWakeRestoresThisHour??0)],
  ['Journey keep-alive',passive.keepAliveRunning?'Running · lets iOS resume the app while precise GPS or a published stop runs without a background session':'Not running'],
  ['Background session released',passive.sessionReleases?`${passive.sessionReleases} times · last ${time(passive.sessionReleasedAt)}`:'Not this session'],
  ['Last precise GPS reason',passive.lastPreciseReason||'None yet'],
  ['Time per location mode (since app start)',modeSummary||'Not reported'],
  ['Home Wi-Fi',wifi.configured?WIFI_MATCH_LABELS[wifi.match]||wifi.match:WIFI_MATCH_LABELS.notConfigured],
  ['Home Wi-Fi last checked',wifi.configured?`${time(wifi.observedAt)}${wifi.source&&wifi.source!=='none'?` · ${wifi.source}`:''}`:'—'],
  ['Departure from rest',latency.engine==='passive'?[`woken by ${latency.cause}`,latency.motionOnsetToEvidenceSeconds!=null?`movement began ${latency.motionOnsetToEvidenceSeconds} s earlier`:null,latency.evidenceToFirstFixSeconds!=null?`first GPS ${latency.evidenceToFirstFixSeconds} s after waking`:null,latency.startGapMeters!=null?`route began ~${latency.startGapMeters} m beyond the place`:null].filter(Boolean).join(' · '):'No departure from passive rest measured yet']
 ];
}
