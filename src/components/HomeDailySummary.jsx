import {useRef} from 'react';
import {ChevronLeft,ChevronRight} from 'lucide-react';
import ActivityIcon from './ActivityIcon.jsx';
import {canShiftForward,dateLabel,shiftDate} from '../lib/activityFilters.js';
import {distanceValue,distanceUnitLabel,tripDistanceText} from '../lib/distanceUnits.js';
import {activityLabel} from '../lib/activityNames.js';
import {dailyJourneyTotals,latestJourneyOfDay} from '../lib/homeDailyStats.js';

// One compact card for Home: the day (with previous / next), its totals, and the latest activity OF THAT DAY.
// The summary opens Activities on the same day; the activity row opens that activity. They are separate
// buttons (never nested). A horizontal swipe on the card only changes the displayed day.
const clock=seconds=>new Date(seconds*1000).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'});
// "8:15 am–8:33 am"; an activity that ends on another day shows only when it began, never an end before its start.
const timeRange=trip=>trip.endedAt&&new Date(trip.endedAt*1000).toDateString()===new Date(trip.startedAt*1000).toDateString()?`${clock(trip.startedAt)}–${clock(trip.endedAt)}`:clock(trip.startedAt);
export default function HomeDailySummary({date,today,journeys,unit,onDateChange,onOpen,onOpenActivity}){
 const touchStart=useRef(null);
 const ignoreClickUntil=useRef(0);
 const totals=dailyJourneyTotals(journeys,date,today);
 const distance=totals.distanceMeters/1000;
 const minutes=Math.floor(totals.durationSeconds/60);
 const forward=canShiftForward(date,today);
 const changeDay=step=>onDateChange(shiftDate(date,step,today));
 const label=dateLabel(date,today);
 const isRelative=label==='Today'||label==='Yesterday';
 const dayText=new Date((date==='today'?today:date)+'T12:00:00').toLocaleDateString('en-AU',{day:'numeric',month:'long'});
 const latest=latestJourneyOfDay(journeys);
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
 // The tap that ends a swipe must not also open anything.
 const guarded=action=>()=>{if(Date.now()<ignoreClickUntil.current)return;action();};
 return <section className="home-day" aria-label="Daily activity summary" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} onTouchCancel={()=>{touchStart.current=null;}}>
  <div className="home-day-head">
   <button type="button" className="home-day-arrow" aria-label="Previous day" onClick={guarded(()=>changeDay(-1))}><ChevronLeft size={20}/></button>
   <h2 className="home-day-title" aria-live="polite"><strong>{label}</strong>{isRelative&&<span> · {dayText}</span>}</h2>
   <button type="button" className="home-day-arrow" aria-label="Next day" disabled={!forward} onClick={guarded(()=>changeDay(1))}><ChevronRight size={20}/></button>
   {date!=='today'&&<button type="button" className="home-day-reset" onClick={guarded(()=>onDateChange('today'))}>Today</button>}
  </div>
  <button type="button" className="home-daily-open" aria-label={`View activities for ${label}`} onClick={guarded(()=>onOpen(date))}>
   <span className="home-daily-stat"><strong>{totals.estimated?'~':''}{distanceValue(distance,unit)} <small>{distanceUnitLabel(unit)}</small></strong></span>
   <span className="home-daily-stat"><strong>{totals.count}</strong> <small>{totals.count===1?'activity':'activities'}</small></span>
   <span className="home-daily-stat"><strong>{minutes}</strong> <small>min</small></span>
   {totals.estimated&&<span className="sr-only">Distance includes estimated GPS gaps</span>}
   <ChevronRight className="home-daily-chevron" size={16} aria-hidden="true"/>
  </button>
  {latest
   ?<button type="button" className="home-day-latest" onClick={guarded(()=>onOpenActivity?.(latest))}>
     <span className="home-day-latest-icon"><ActivityIcon activity={activityLabel(latest.activity)} size={18}/></span>
     <span className="home-day-latest-text"><strong>{latest.title||activityLabel(latest.activity)}</strong><small>{timeRange(latest)} · {activityLabel(latest.activity)} · {tripDistanceText(latest,unit)}</small></span>
     <ChevronRight size={16} aria-hidden="true"/>
    </button>
   :<p className="home-day-empty">{label==='Today'?'No activities yet today.':'No activities on this day.'}</p>}
 </section>;
}
