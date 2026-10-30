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
  ['Rest',passive.restConfirmed?`Confirmed · ${passive.restReason}`:passive.restReason||'Not confirmed'],
  ['Passive rest',passive.active?`Active since ${time(passive.since)} · no location updates, no background session`:`Not active · ${passive.retainReason||'waiting'}`],
  ['Always service session',SERVICE_SESSION_LABELS[passive.serviceSession]||passive.serviceSession||'Not reported'],
  ['Journey keep-alive',passive.keepAliveRunning?'Running · lets iOS resume the app while precise GPS runs without a background session':'Not running'],
  ['Background session released',passive.sessionReleases?`${passive.sessionReleases} times · last ${time(passive.sessionReleasedAt)}`:'Not this session'],
  ['Last precise GPS reason',passive.lastPreciseReason||'None yet'],
  ['Time per location mode (since app start)',modeSummary||'Not reported'],
  ['Home Wi-Fi',wifi.configured?WIFI_MATCH_LABELS[wifi.match]||wifi.match:WIFI_MATCH_LABELS.notConfigured],
  ['Home Wi-Fi last checked',wifi.configured?`${time(wifi.observedAt)}${wifi.source&&wifi.source!=='none'?` · ${wifi.source}`:''}`:'—'],
  ['Departure from rest',latency.engine==='passive'?[`woken by ${latency.cause}`,latency.motionOnsetToEvidenceSeconds!=null?`movement began ${latency.motionOnsetToEvidenceSeconds} s earlier`:null,latency.evidenceToFirstFixSeconds!=null?`first GPS ${latency.evidenceToFirstFixSeconds} s after waking`:null,latency.startGapMeters!=null?`route began ~${latency.startGapMeters} m beyond the place`:null].filter(Boolean).join(' · '):'No departure from passive rest measured yet']
 ];
}
