// Place awareness never includes coordinates; the radius is rounded natively.
export function placeText(place){
 if(!place)return 'Not reported by installed native build';
 if(place.state==='none')return 'No current place'+(place.lastDecision?' · last: '+place.lastDecision:'');
 const source={saved:place.kind==='home'?'Home (saved)':'Saved place',visit:'Visit reported by iOS',arrival:'Where the last journey stopped',inferred:'Inferred from staying put'}[place.state]||place.state;
 return source+' · about '+place.radiusMeters+' m · '+place.minutes+' min'+(place.settled?' · settled':'')+(place.lastDecision?' · last: '+place.lastDecision:'');
}
