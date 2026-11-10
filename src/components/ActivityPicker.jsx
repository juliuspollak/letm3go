import {useLayoutEffect,useRef} from 'react';
import {Activity,Bike,Car,Check,Compass,Dumbbell,Footprints,Mountain,Waves} from 'lucide-react';

const choices=[
 ['Walking',Footprints,'walk','#287c68'],['Running',Activity,'run','#bd5a30'],
 ['Cycling',Bike,'ride','#5168d8'],['Hiking',Mountain,'hike','#48784b'],
 ['Driving',Car,'drive','#7661ba'],['Kitesurfing',Waves,'surf','#247f99'],
 ['Gym',Dumbbell,'lift','#ad4d80'],['Other',Compass,'explore','#64748b'],
];
const family=value=>['Cycling','Road cycling','MTB'].includes(value)?'Cycling':value;

export default function ActivityPicker({value,onChange}){
 const grid=useRef(null),selection=useRef(null);
 const selected=family(value);
 useLayoutEffect(()=>{
  const element=grid.current,indicator=selection.current;
  const update=()=>{
   const tile=element?.querySelector('[aria-pressed="true"]');
   if(!tile||!indicator)return;
   // Layout coordinates stay stable during the icon/press animations. The same
   // panel moves between tiles; selection never remounts or steals focus.
   Object.assign(indicator.style,{width:`${tile.offsetWidth}px`,height:`${tile.offsetHeight}px`,
    transform:`translate3d(${tile.offsetLeft}px,${tile.offsetTop}px,0)`});
   indicator.dataset.ready='true';
  };
  update();
  if(typeof ResizeObserver==='undefined')return;
  const observer=new ResizeObserver(update);observer.observe(element);
  return()=>observer.disconnect();
 },[selected]);
 const tint=choices.find(([name])=>name===selected)?.[3];
 return <div ref={grid} className="record-types activity-family-grid manual-activity-picker" aria-label="Activity type" style={{'--tile-accent':tint}}>
  <span ref={selection} className="activity-selection" aria-hidden="true"/>
  {choices.map(([name,Icon,motion,color])=><button type="button" key={name}
   className={`activity-tile${selected===name?' selected':''}`} aria-pressed={selected===name}
   data-motion={motion} style={{'--tile-accent':color}} onClick={()=>onChange(name)}>
   <span className="activity-tile-icon" aria-hidden="true"><Icon size={27} strokeWidth={1.65}/></span>
   <span className="activity-tile-label">{name}</span>
   <span className="activity-tile-check" aria-hidden="true"><Check size={11} strokeWidth={3}/></span>
  </button>)}
 </div>;
}
