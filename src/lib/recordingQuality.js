// GPS quality is derived from the recorded positions; no routing or gap interpolation.
export function quality(trip){
 const points=(trip.points||[]).filter(p=>Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Number.isFinite(p.timestamp));
 // A deliberate stop the journey continued from is time spent stopped, not a GPS gap.
 const stops=trip.details?.stops||[];
 const pairs=points.slice(1).map((p,i)=>({seconds:p.timestamp-points[i].timestamp,broken:p.segment!==points[i].segment,
  stop:p.segment!==points[i].segment&&stops.some(s=>s.start>=points[i].timestamp-1&&s.start<=p.timestamp+1)})).filter(p=>p.seconds>0);
 const gaps=pairs.filter(p=>!p.stop);
 const gap=gaps.reduce((max,p)=>Math.max(max,p.seconds),0),broken=gaps.filter(p=>p.broken).length;
 const accuracy=points.map(p=>p.accuracy).filter(n=>Number.isFinite(n)&&n>=0).sort((a,b)=>a-b);
 const median=accuracy.length?accuracy[Math.floor(accuracy.length/2)]:null;
 const startLag=points.length?Math.max(0,points[0].timestamp-trip.startedAt):null;
 const endLag=points.length&&Number.isFinite(trip.endedAt)?Math.max(0,trip.endedAt-points.at(-1).timestamp):null;
 const warnings=[];
 if(points.length<5)warnings.push('Very few GPS fixes');
 if(gap>60)warnings.push('GPS coverage gaps');
 if(median!=null&&median>25)warnings.push('Low GPS precision');
 if(startLag!=null&&startLag>30)warnings.push('Delayed first fix');
 if(endLag!=null&&endLag>30)warnings.push('Last fix before arrival');
 const stopped=pairs.filter(p=>p.stop);
 return {points:points.length,gap,broken,median,startLag,endLag,warnings,stops:stopped.length,stoppedSeconds:stopped.reduce((n,p)=>n+p.seconds,0)};
}
