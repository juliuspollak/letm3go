import {useMemo,useState} from 'react';
import AppleMap from './AppleMap.jsx';
const EMPTY_PINS=[];
// The saved-place editor's map. It is the live native map: it can be panned and zoomed, and a tap on it places the pin. `radius` is the
// circle that decides what counts as the place (a Home's recognition radius); `arrivalRadius` is a Home's separate arrival and
// place-name circle, drawn dashed. Both follow the sliders as they move.
export default function PlacePicker({point,center,radius,arrivalRadius,onPick,peoplePins=EMPTY_PINS}){
 const [peopleFit,setPeopleFit]=useState(0);
 const latitude=point?.latitude,longitude=point?.longitude;
 const {latitude:centerLat,longitude:centerLon}=center||{};
 const hasPoint=Number.isFinite(latitude)&&Number.isFinite(longitude);
 const payload=useMemo(()=>({
  routes:[],
  ...(peopleFit?{pickerPeopleFit:peopleFit}:{}),
  ...(!hasPoint&&Number.isFinite(centerLat)&&Number.isFinite(centerLon)?{focus:[centerLat,centerLon]}:{}),
  pins:hasPoint?[{point:[latitude,longitude],title:'Saved place',kind:'place',radius,...(arrivalRadius?{arrivalRadius}:{})},...peoplePins]:peoplePins
 }),[hasPoint,latitude,longitude,radius,arrivalRadius,centerLat,centerLon,peoplePins,peopleFit]);
 return <>
  {peoplePins.length>0&&<button type="button" className="text-button" onClick={()=>setPeopleFit(value=>value+1)}>Show people on map</button>}
  <AppleMap pickable payload={payload} onPick={onPick}/>
 </>;
}
