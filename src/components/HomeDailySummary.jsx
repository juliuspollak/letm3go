import {useRef} from 'react';
import {ChevronRight, Clock3, ListChecks, Route} from 'lucide-react';
import {canShiftForward,dateLabel,shiftDate} from '../lib/activityFilters.js';
import {distanceValue,distanceUnitLabel} from '../lib/distanceUnits.js';

// A single entry into Activities. Gestures only change the displayed day;
// tapping the summary opens the same day in the existing Activities date filter.
export default function HomeDailySummary({date,today,journeys,unit,onDateChange,onOpen}){
 const touchStart=useRef(null);
 const ignoreClickUntil=useRef(0);
 const distance=journeys.reduce((sum,journey)=>sum+(journey.distanceMeters||0),0)/1000;
 const minutes=Math.floor(journeys.reduce((sum,journey)=>sum+(journey.durationSeconds||0),0)/60);
 const forward=canShiftForward(date,today);
 const changeDay=step=>onDateChange(shiftDate(date,step,today));
 const onTouchStart=event=>{
  const touch=event.touches[0];
  touchStart.current=touch?{x:touch.clientX,y:touch.clientY}:null;
 };
 const onTouchEnd=event=>{
  if(!touchStart.current)return;
  const touch=event.changedTouches[0];
  const dx=touch.clientX-touchStart.current.x;
  const dy=touch.clientY-touchStart.current.y;
  touchStart.current=null;
  if(Math.abs(dx)<45||Math.abs(dx)<Math.abs(dy)*1.25)return;
  // Swiping left browses older days, swiping right returns towards Today.
  if(dx<0||forward){
   ignoreClickUntil.current=Date.now()+650;
   changeDay(dx<0?-1:1);
  }
 };
 const open=()=>{
  if(Date.now()<ignoreClickUntil.current)return;
  onOpen(date);
 };
 return <section className="home-daily-summary" aria-label="Daily activity summary">
  <div className="home-daily-heading">
   <button type="button" className="home-day-arrow" aria-label="Previous day" onClick={()=>changeDay(-1)}><ChevronRight className="trip-prev-icon" size={19}/></button>
   <div className="home-day-title" aria-live="polite"><strong>{dateLabel(date,today)}</strong><span>{new Date((date==='today'?today:date)+'T12:00:00').toLocaleDateString('en-AU',{weekday:'short',day:'numeric',month:'long'})}</span></div>
   <button type="button" className="home-day-arrow" aria-label="Next day" disabled={!forward} onClick={()=>changeDay(1)}><ChevronRight size={19}/></button>
   {date!=='today'&&<button type="button" className="home-day-reset" onClick={()=>onDateChange('today')}>Today</button>}
  </div>
  <button type="button" className="home-daily-open" aria-label={`View activities for ${dateLabel(date,today)}`} onClick={open} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} onTouchCancel={()=>{touchStart.current=null;}}>
   <span className="home-daily-stats">
    <span className="home-daily-stat"><Route size={18}/><strong>{distanceValue(distance,unit)} <small>{distanceUnitLabel(unit)}</small></strong><span>Distance</span></span>
    <span className="home-daily-stat"><ListChecks size={18}/><strong>{journeys.length}</strong><span>Activities</span></span>
    <span className="home-daily-stat"><Clock3 size={18}/><strong>{minutes} <small>min</small></strong><span>Recorded</span></span>
   </span>
   <span className="home-daily-link">View activities <ChevronRight size={15}/></span>
  </button>
 </section>;
}
