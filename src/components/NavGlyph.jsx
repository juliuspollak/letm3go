const GLYPHS={
 Home:<>
  <path className="glyph-roof" d="M4 10.7 12 4.3l8 6.4"/>
  <path className="glyph-wall" d="M6.2 9.6v9.7h11.6V9.6"/>
  <path className="glyph-door" d="M9.8 19.3v-4.7h4.4v4.7"/>
 </>,
 Map:<>
  <path className="glyph-fold glyph-fold-left" d="M3.4 7.4 9 5.2l6 2.2 5.6-2.2v11.4L15 18.8 9 16.6l-5.6 2.2z"/>
  <path className="glyph-crease" d="M9 5.2v11.4M15 7.4v11.4"/>
  <path className="glyph-pin" d="M12 6.6c1.8 0 3.2 1.4 3.2 3.2 0 2.2-3.2 5.2-3.2 5.2S8.8 12 8.8 9.8c0-1.8 1.4-3.2 3.2-3.2Z"/>
  <circle className="glyph-pin-dot" cx="12" cy="9.8" r="1.05"/>
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

