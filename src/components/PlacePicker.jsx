import {useMemo} from 'react';
import AppleMap from './AppleMap.jsx';
// The saved-place editor's map. It is the live native map: it can be panned and zoomed, and a tap on it places the pin. `radius` is the
// circle that decides what counts as the place (a Home's recognition radius); `arrivalRadius` is a Home's separate arrival and
// place-name circle, drawn dashed. Both follow the sliders as they move.
export default function PlacePicker({point,radius,arrivalRadius,onPick}){
 const latitude=point?.latitude,longitude=point?.longitude;
 const payload=useMemo(()=>({routes:[],pins:Number.isFinite(latitude)&&Number.isFinite(longitude)?[{point:[latitude,longitude],title:'Saved place',kind:'place',radius,...(arrivalRadius?{arrivalRadius}:{})}]:[]}),[latitude,longitude,radius,arrivalRadius]);
 return <AppleMap pickable payload={payload} onPick={onPick}/>;
}
