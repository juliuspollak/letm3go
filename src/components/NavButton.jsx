import {useState} from 'react';
import NavGlyph from './NavGlyph.jsx';

// A navigation button that replays its glyph animation on every tap. The tab is
// changed in the same click, so the animation is never a prerequisite for
// navigation. The visible label is hidden on the compact iPhone tab bar (icons
// only); the `aria-label` keeps every destination announced by VoiceOver.
export default function NavButton({name,active=false,onSelect,className='',children}){
 const [pulse,setPulse]=useState(0);
 return <button type="button" className={`${active?'active':''}${className?` ${className}`:''}`.trim()||undefined} aria-label={name} aria-current={active?'page':undefined} onClick={()=>{setPulse(value=>value+1);onSelect();}}>
  <NavGlyph name={name} active={active} pulse={pulse}/>
  <span className="nav-label">{children??name}</span>
 </button>;
}
