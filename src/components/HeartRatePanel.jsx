import {useMemo,useRef,useState} from 'react';
import {Heart} from 'lucide-react';
import {heartRateOf,heartRateRuns,routeAt,savedMaximum,saveMaximum,timeInZones} from '../lib/heartRate.js';
import {distanceText} from '../lib/distanceUnits.js';

const W=320,H=132,LEFT=30,RIGHT=6,TOP=8,BOTTOM=20;
const clock=seconds=>{const total=Math.max(0,Math.round(seconds)),h=Math.floor(total/3600),m=Math.floor(total/60)%60,s=total%60;return h?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}`;};
const minutes=seconds=>seconds<60?`${Math.round(seconds)} s`:`${Math.round(seconds/60)} min`;

function Chart({record,points,startedAt,endedAt,unit}){
 const {samples,pausePeriods}=record,ref=useRef(null),[hover,setHover]=useState(null);
 const scale=useMemo(()=>{
  const start=startedAt??samples[0].timestamp,end=Math.max(endedAt??samples.at(-1).timestamp,start+1);
  const values=samples.map(s=>s.bpm),low=Math.floor(Math.min(...values)/10)*10,high=Math.ceil(Math.max(...values)/10)*10+(Math.max(...values)%10===0?10:0);
  return {start,end,low,high,x:t=>LEFT+(t-start)/(end-start)*(W-LEFT-RIGHT),y:v=>TOP+(high-v)/(high-low)*(H-TOP-BOTTOM)};
 },[samples,startedAt,endedAt]);
 const runs=useMemo(()=>heartRateRuns(samples,pausePeriods),[samples,pausePeriods]);
 const paths=runs.filter(r=>r.length>1).map(r=>r.map((s,i)=>`${i?'L':'M'}${scale.x(s.timestamp).toFixed(1)} ${scale.y(s.bpm).toFixed(1)}`).join(''));
 const lone=runs.filter(r=>r.length===1).map(r=>r[0]);
 function move(event){
  const box=ref.current?.getBoundingClientRect();
  if(!box?.width)return;
  const t=scale.start+((event.clientX-box.left)/box.width*W-LEFT)/(W-LEFT-RIGHT)*(scale.end-scale.start);
  setHover(samples.reduce((best,s)=>Math.abs(s.timestamp-t)<Math.abs(best.timestamp-t)?s:best,samples[0]));
 }
 const place=hover&&routeAt(points,hover.timestamp);
 const ticks=[scale.low,Math.round((scale.low+scale.high)/2),scale.high];
 return <figure className="heart-chart">
  <figcaption className="heart-readout" aria-live="polite">{hover?<><strong>{Math.round(hover.bpm)} BPM</strong><span>{clock(hover.timestamp-scale.start)}{place?` · ${distanceText(place.distanceMeters/1000,unit)}`:''}{place?.speed!=null?` · ${(place.speed*3.6).toFixed(1)} km/h`:''}</span></>:<span>Touch the graph to read a moment</span>}</figcaption>
  <svg ref={ref} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Heart rate over time, ${Math.round(record.summary.minimum)} to ${Math.round(record.summary.maximum)} BPM`} onPointerMove={move} onPointerDown={move} onPointerLeave={()=>setHover(null)} style={{touchAction:'pan-y'}}>
   {pausePeriods.map(p=><rect key={p.start} className="heart-paused" x={scale.x(p.start)} y={TOP} width={Math.max(1,scale.x(p.end)-scale.x(p.start))} height={H-TOP-BOTTOM}/>)}
   {ticks.map(v=><g key={v}><line className="heart-grid" x1={LEFT} x2={W-RIGHT} y1={scale.y(v)} y2={scale.y(v)}/><text className="heart-axis" x={LEFT-4} y={scale.y(v)+3} textAnchor="end">{v}</text></g>)}
   <text className="heart-axis" x={LEFT} y={H-6}>0:00</text><text className="heart-axis" x={W-RIGHT} y={H-6} textAnchor="end">{clock(scale.end-scale.start)}</text>
   {paths.map(d=><path key={d} className="heart-line" d={d}/>)}
   {lone.map(s=><circle key={s.timestamp} className="heart-dot" cx={scale.x(s.timestamp)} cy={scale.y(s.bpm)} r="2"/>)}
   {hover&&<><line className="heart-cross" x1={scale.x(hover.timestamp)} x2={scale.x(hover.timestamp)} y1={TOP} y2={H-BOTTOM}/><circle className="heart-dot heart-dot-focus" cx={scale.x(hover.timestamp)} cy={scale.y(hover.bpm)} r="4"/></>}
  </svg>
  {pausePeriods.length>0&&<p className="muted small-copy">Shaded: paused, not recorded.</p>}
 </figure>;
}

function Zones({record,owner}){
 const [maximum,setMaximum]=useState(()=>savedMaximum(owner)),[draft,setDraft]=useState('');
 const result=useMemo(()=>maximum?timeInZones(record.samples,record.pausePeriods,maximum):null,[record,maximum]);
 if(!result)return <form className="heart-zones-setup" onSubmit={e=>{e.preventDefault();setMaximum(saveMaximum(owner,draft));}}>
  <label>Maximum heart rate<input inputMode="numeric" value={draft} placeholder="BPM" aria-label="Maximum heart rate in BPM" onChange={e=>setDraft(e.target.value)}/></label>
  <button type="submit" className="secondary" disabled={!draft}>Show zones</button>
  <p className="muted small-copy">Zones need your own maximum, from a test or your doctor. This activity reached {Math.round(record.summary.maximum)} BPM, which may be lower than your true maximum.</p>
 </form>;
 return <div className="heart-zones"><table><thead><tr><th>Zone</th><th>BPM</th><th>Time</th></tr></thead><tbody>
  {result.zones.slice().reverse().map(zone=><tr key={zone.id}><td>{zone.name}</td><td>{zone.toBpm?`${zone.fromBpm}–${zone.toBpm-1}`:`${zone.fromBpm}+`}</td><td><span className="heart-zone-bar" style={{'--share':zone.share}} aria-hidden="true"/>{minutes(zone.seconds)}</td></tr>)}
 </tbody></table>
 <p className="muted small-copy">Zones are 10% bands of the maximum you entered ({maximum} BPM). {result.belowSeconds>0?`${minutes(result.belowSeconds)} below Zone 1. `:''}Gaps and pauses count for no zone.</p>
 <button type="button" className="text-button" onClick={()=>{setDraft(String(maximum));setMaximum(saveMaximum(owner,''));}}>Change maximum heart rate</button></div>;
}

export default function HeartRatePanel({trip,owner,unit}){
 const record=heartRateOf(trip);
 if(!record)return trip?.source==='watch'&&trip?.details?.indoor?<p className="muted small-copy heart-none">No heart rate was recorded for this activity.</p>:null;
 const {summary}=record;
 return <section className="heart-rate" aria-label="Heart rate">
  <h2><Heart size={17} aria-hidden="true"/> Heart rate</h2>
  <div className="record-metrics"><div><strong>{Math.round(summary.average)} BPM</strong><span>Average</span></div><div><strong>{Math.round(summary.maximum)} BPM</strong><span>Maximum</span></div></div>
  <Chart record={record} points={trip.points} startedAt={trip.startedAt} endedAt={trip.endedAt} unit={unit}/>
  {summary.gaps>0&&<p className="muted small-copy">{summary.gaps===1?'One stretch':`${summary.gaps} stretches`} had no readings and {summary.gaps===1?'is':'are'} left empty.</p>}
  <h3>Time in zones</h3>
  <Zones record={record} owner={owner}/>
 </section>;
}
