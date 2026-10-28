import {NAV_ITEMS} from '../lib/navigation.js';
import NavButton from './NavButton.jsx';
import RecordControl from './RecordControl.jsx';

// The record destination is a raised circular control rather than a fifth icon:
// it is the primary action, and it also shows the live recording state from any
// screen. It still only navigates to the Record tab, exactly as before. Icons are
// label-free on the compact iPhone tab bar; every control carries an `aria-label`.
export default function MobileNav({tab,onSelect,recordState='idle'}){
 const status=recordState==='recording'?'Recording in progress':recordState==='paused'?'Recording paused':recordState==='auto'?'Automatic journey in progress':'';
 return <nav className="mobile-nav" aria-label="Sections">
  {status&&<span className="sr-only" role="status">{status}</span>}
  {NAV_ITEMS.map(({name})=>name==='Record'
   ?<div className={`mobile-nav-record${tab===name?' is-current':''}`} key={name}>
     <RecordControl variant="nav" state={recordState} current={tab===name} label="Record" title={recordState==='recording'?'Recording — open the record screen':recordState==='auto'?'Automatic journey active — open the record screen':'Record'} onClick={()=>onSelect(name)}/>
    </div>
   :<NavButton key={name} name={name} active={tab===name} onSelect={()=>onSelect(name)}/>)}
 </nav>;
}
