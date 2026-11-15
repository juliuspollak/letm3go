// Weather kept on an activity by the phone (Apple WeatherKit): a condition, a symbol name and °C.
export const weatherOf=trip=>{const w=trip?.details?.weather;return w&&Number.isFinite(w.temperatureC)&&typeof w.symbol==='string'?w:null;};
// Which icon draws a WeatherKit SF Symbol name.
export function weatherKind(symbol=''){
 const s=symbol.toLowerCase();
 if(s.includes('bolt')||s.includes('tropicalstorm')||s.includes('hurricane'))return 'storm';
 if(s.includes('snow')||s.includes('sleet')||s.includes('hail'))return 'snow';
 if(s.includes('heavyrain')||s.includes('rain'))return 'rain';
 if(s.includes('drizzle'))return 'drizzle';
 if(s.includes('fog')||s.includes('haze')||s.includes('smoke'))return 'fog';
 if(s.includes('wind'))return 'wind';
 if(s.includes('cloud.sun')||s.includes('cloud.moon'))return 'partly';
 if(s.includes('cloud'))return 'cloud';
 if(s.includes('moon'))return 'night';
 return 'sun';
}
export const temperatureText=celsius=>`${Math.round(celsius)}°`;
export const weatherText=w=>w?`${w.condition} · ${temperatureText(w.temperatureC)}${Number.isFinite(w.windKph)&&w.windKph>=30?` · wind ${Math.round(w.windKph)} km/h`:''}`:'';
