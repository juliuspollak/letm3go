import {useMemo} from 'react';
import AppleMap from './AppleMap.jsx';
// The saved-place editor's map. It is live, so it can be panned and zoomed, and a tap on it places the pin. `radius` is the circle
// that decides what counts as the place (a Home's recognition radius); `arrivalRadius` is a Home's separate arrival and place-name
// circle, drawn dashed. Both follow the sliders as they move. Where the live map cannot be shown, a still picture opens the
// full-screen chooser instead, and its answer comes back through the same handler.
export default function PlacePicker({point,radius,arrivalRadius,onPick}){
 const latitude=point?.latitude,longitude=point?.longitude;
 const payload=useMemo(()=>({routes:[],pins:Number.isFinite(latitude)&&Number.isFinite(longitude)?[{point:[latitude,longitude],title:'Saved place',kind:'place',radius,...(arrivalRadius?{arrivalRadius}:{})}]:[]}),[latitude,longitude,radius,arrivalRadius]);
 const chosen=result=>{if(Number.isFinite(result?.latitude)&&Number.isFinite(result?.longitude))onPick({latitude:result.latitude,longitude:result.longitude});};
 return <AppleMap pickable payload={payload} onPick={chosen} onResult={chosen}/>;
}
