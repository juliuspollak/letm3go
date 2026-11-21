import {activityLabel} from '../lib/activityNames.js';
import {formatDuration} from '../lib/peopleMap.js';

// A recording running on another device (the Apple Watch) is easy to forget: the Watch is on the wrist, the phone is in a
// pocket, and nothing on the phone said so unless the Record screen was open. This sits on every screen until it ends.
// `elsewhere` is the native snapshot's recordingElsewhere: {label, activity, state, startedAt, sessionID}.
export default function WatchRecordingBanner({elsewhere,nowMs,onOpen}){
 if(!elsewhere)return null;
 // The native snapshot labels it "Recording on Apple Watch"; only the device name belongs in the sentence.
 const device=(elsewhere.label||'Apple Watch').replace(/^Recording on /,'');
 const seconds=Number.isFinite(elsewhere.startedAt)&&Number.isFinite(nowMs)?Math.max(0,Math.round(nowMs/1000-elsewhere.startedAt)):null;
 const activity=activityLabel(elsewhere.activity)||'an activity';
 const paused=elsewhere.state==='paused';
 const text=`${device} ${paused?'has paused':'is recording'} ${activity}${seconds!=null?` · ${formatDuration(seconds)}`:''}`;
 // Running for hours is almost always a forgotten recording: say so, and make the way out obvious.
 const long=seconds!=null&&seconds>=2*3600;
 return <div className={`watch-recording-banner${long?' is-long':''}`} role="status">
  <span className="watch-recording-dot" aria-hidden="true"/>
  <span className="watch-recording-text"><strong>{text}</strong>{long&&<small>Still going? Finish it on your Watch or open Record.</small>}</span>
  <button type="button" className="text-button" onClick={onOpen}>Open</button>
 </div>;
}
