import {Cloud,CloudDrizzle,CloudFog,CloudLightning,CloudRain,CloudSun,Moon,Snowflake,Sun,Wind} from 'lucide-react';
import {temperatureText,weatherKind,weatherOf,weatherText} from '../lib/weather.js';

const ICONS={storm:CloudLightning,snow:Snowflake,rain:CloudRain,drizzle:CloudDrizzle,fog:CloudFog,wind:Wind,partly:CloudSun,cloud:Cloud,night:Moon,sun:Sun};

// A small weather icon and temperature, drawn only when the activity has weather.
export default function WeatherBadge({trip}){
 const weather=weatherOf(trip);
 if(!weather)return null;
 const Icon=ICONS[weatherKind(weather.symbol)]||Sun;
 return <span className="weather-badge" title={weatherText(weather)} aria-label={`Weather: ${weatherText(weather)}`}><Icon size={13} aria-hidden="true"/>{temperatureText(weather.temperatureC)}</span>;
}
