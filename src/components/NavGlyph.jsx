const GLYPHS={
 Home:<>
  <path className="glyph-roof" d="M4 10.7 12 4.3l8 6.4"/>
  <path className="glyph-wall" d="M6.2 9.6v9.7h11.6V9.6"/>
  <path className="glyph-door" d="M9.8 19.3v-4.7h4.4v4.7"/>
 </>,
 Map:<>
  <path className="glyph-ground" d="M7.9 17.1c-2.5.5-4.1 1.4-4.1 2.4 0 1.4 3.7 2.5 8.2 2.5s8.2-1.1 8.2-2.5c0-1-1.6-1.9-4.1-2.4"/>
  <path className="glyph-pin" d="M12 19s-6-5-6-9.6a6 6 0 1 1 12 0C18 14 12 19 12 19Z"/>
  <circle className="glyph-pin-dot" cx="12" cy="9.4" r="2.1"/>
 </>,
 Trips:<>
  <path className="glyph-route" d="M4.8 19.2c0-4.4 3.2-6.4 7.2-7.4s7.2-2.8 7.2-7.2"/>
  <circle className="glyph-start" cx="4.8" cy="19.2" r="1.8"/>
  <circle className="glyph-marker" cx="19.2" cy="4.6" r="1.9"/>
 </>,
 Record:<>
  <circle className="glyph-ring" cx="12" cy="12" r="8.2"/>
  <circle className="glyph-core" cx="12" cy="12" r="3.4"/>
 </>,
 Social:<>
  <circle className="glyph-person" cx="8.8" cy="8.7" r="2.9"/>
  <path className="glyph-person" d="M3.5 18.8c0-3 2.4-5 5.3-5s5.3 2 5.3 5"/>
  <circle className="glyph-friend" cx="16.9" cy="8.3" r="2.2"/>
  <path className="glyph-friend" d="M15.7 13.3c2.7-.2 4.8 1.5 4.8 4.2"/>
 </>
};

// Each destination animates on tap without holding up navigation: the tab changes
// immediately and the glyph replays afterwards. `key` remounts the drawing group so
// every tap restarts the CSS animation, and because the viewBox never changes the
// navigation layout cannot shift.
export default function NavGlyph({name='Home',active=false,pulse=0}){
 return <svg className={`nav-glyph nav-glyph--${name.toLowerCase()}${active?' is-active':''}`} data-animate={pulse>0?'on':'off'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
  <g key={pulse}>{GLYPHS[name]||GLYPHS.Home}</g>
 </svg>;
}

