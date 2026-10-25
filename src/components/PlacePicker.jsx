import AppleMap from './AppleMap.jsx';
export default function PlacePicker({point,radius,onPick}){
 return <AppleMap picker payload={{routes:[],pins:point?[{point:[point.latitude,point.longitude],title:'Saved place',kind:'place',radius}]:[]}} onResult={result=>{if(Number.isFinite(result.latitude)&&Number.isFinite(result.longitude))onPick({latitude:result.latitude,longitude:result.longitude});}}/>;
}
