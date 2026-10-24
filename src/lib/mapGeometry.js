// Display simplification only. The native route and backup retain every GPS fix.
export function displaySegments(journey,limit=2000){
 const segments=journey.routeSegments||[journey.route||[]];
 const count=segments.reduce((n,s)=>n+s.length,0);
 if(count<=limit)return segments;
 const stride=Math.ceil(count/limit);
 return segments.map(segment=>segment.filter((_,i)=>i===0||i===segment.length-1||i%stride===0));
}
