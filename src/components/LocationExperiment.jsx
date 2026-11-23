import {useState} from 'react';
import {EXPERIMENT_MODES,OBSERVATIONS,experimentRows} from '../lib/locationExperiment.js';
// Developer-only. Hidden until the Tracking & Permissions title is tapped seven times. It never changes what a normal user gets: the
// mode is A unless someone selects B or C here, and it returns to A after 48 hours.
export default function LocationExperiment({state,run,busy}){
 const experiment=state.experiment;
 const [note,setNote]=useState('');
 if(!experiment?.available||!experiment.unlocked)return null;
 const blocked=experiment.blocked||{};
 const disabled=busy||!state.storageReady;
 return <section className="tracking-experiment" aria-label="Location experiment (developer)">
  <h3>Location experiment (developer)</h3>
  <p className="muted small-copy">For comparing how iOS treats the background location session. Do not leave it on a phone someone relies on: Modes B and C change background behaviour. The mode returns to A after 48 hours, and cannot change during a journey or while a recording is being recovered.</p>
  <div className="experiment-modes" role="radiogroup" aria-label="Experiment mode">
   {EXPERIMENT_MODES.map(item=>{
    const selected=experiment.mode===item.mode,why=!selected&&blocked[item.mode];
    return <div key={item.mode} className="experiment-mode">
     <button type="button" role="radio" aria-checked={selected} aria-label={`Mode ${item.mode.toUpperCase()}`} className={selected?'primary':'secondary'} disabled={disabled||!!why} onClick={()=>run('setLocationExperimentMode',item.mode)}>{item.label}</button>
     <p className="muted small-copy">{item.detail}{why?` Cannot switch now: ${why}.`:''}</p>
    </div>;
   })}
  </div>
  <div className="experiment-observation" role="group" aria-label="Record what you see on the iPhone">
   <strong>What do you physically see on the iPhone right now?</strong>
   <p className="muted small-copy">Look at the status bar, then record it. This is your observation and is stored apart from the app's prediction below. The note is not included in the shared diagnostic log, so keep your own time-stamped record of where you were.</p>
   <input aria-label="Observation note" maxLength={80} value={note} onChange={event=>setNote(event.target.value)} placeholder="Optional note (kept on this iPhone only)"/>
   <div className="experiment-observation-buttons">
    {OBSERVATIONS.map(item=><button key={item.value} type="button" className="secondary" disabled={disabled} onClick={async()=>{if(await run('recordIndicatorObservation',item.value,note))setNote('');}}>{item.label}</button>)}
   </div>
  </div>
  <dl className="tracking-diagnostics">{experimentRows(experiment).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  <button type="button" className="secondary full" disabled={disabled} onClick={()=>run('setLocationExperimentUnlocked',false)}>Hide the experiment and return to Mode A</button>
 </section>;
}
