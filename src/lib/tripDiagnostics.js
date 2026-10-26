export function tripDiagnostics(trip){
 const pts=(trip.points||[]).filter(p=>Number.isFinite(p?.latitude)&&Number.isFinite(p?.longitude)&&Number.isFinite(p?.timestamp)).sort((a,b)=>a.timestamp-b.timestamp);
 const accuracy=pts.map(p=>p.accuracy).filter(x=>Number.isFinite(x)&&x>=0).sort((a,b)=>a-b);
 const intervals=pts.slice(1).map((p,i)=>p.timestamp-pts[i].timestamp).filter(x=>x>=0);
 const longestGap=intervals.length?Math.max(...intervals):0;
 const lag=pts.length&&Number.isFinite(trip.startedAt)?Math.max(0,pts[0].timestamp-trip.startedAt):null;
 const endLag=pts.length&&Number.isFinite(trip.endedAt)?Math.max(0,trip.endedAt-pts.at(-1).timestamp):null;
 const medianAccuracy=accuracy.length?accuracy[Math.floor(accuracy.length/2)]:null;
 const warnings=[];
 if(pts.length<5)warnings.push('Very few usable GPS samples');
 if(longestGap>45)warnings.push('Long gap between GPS samples');
 if(lag!=null&&lag>20)warnings.push('Recording began before accurate GPS was available');
 if(medianAccuracy!=null&&medianAccuracy>35)warnings.push('Poor GPS accuracy');
 if(endLag!=null&&endLag>25)warnings.push('GPS stopped before the activity finished');
 if(Number(trip.distanceMeters||0)<100&&Number(trip.endedAt||0)-Number(trip.startedAt||0)<120)warnings.push('Short low-distance detection; review classification');
 return {points:pts.length,longestGap,lag,endLag,medianAccuracy,warnings,events:trip.details?.trackingNotes||[]};
}
