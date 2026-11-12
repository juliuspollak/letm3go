// Geometry of the HTML placeholder that the native MKMapView is positioned over.
// The native map lives inside the WebView's scroll view, so a page scroll moves
// it automatically. Comparing the *document* position (pageY) rather than the
// viewport position means a scroll does not look like a geometry change: the
// expensive embed path is no longer triggered by scrolling, and only real layout
// changes (a sheet detent, rotation, keyboard) reposition the map.
export const MAP_MIN_EXTENT=80;

export function surfaceGeometry(surface,win=typeof window==='undefined'?null:window){
 if(!surface?.getBoundingClientRect||!win)return null;
 const box=surface.getBoundingClientRect();
 const document=win.document;
 const nav=document?.querySelector?.('.mobile-nav');
 let navTop=win.innerHeight??box.bottom;
 if(nav&&win.getComputedStyle&&win.getComputedStyle(nav).display!=='none')navTop=nav.getBoundingClientRect().top;
 // The bottom navigation must never cover the map, so the embed stops above it.
 const height=Math.min(box.height,Math.max(0,navTop-box.top-8));
 const scrollY=win.scrollY??win.pageYOffset??0,scrollX=win.scrollX??win.pageXOffset??0;
 return {
  x:Math.round(box.x*10)/10,
  y:Math.round(box.y*10)/10,
  width:Math.round(box.width*10)/10,
  height:Math.round(height*10)/10,
  // Document coordinates: the viewport position plus the page's own scroll position at this same
  // moment. This is what the native side places the map by (it must not read its own scroll offset
  // later and add it to a viewport position measured earlier).
  pageX:Math.round((box.x+scrollX)*10)/10,
  pageY:Math.round((box.y+scrollY)*10)/10,
  // For diagnostics: where the tab bar starts and how tall the viewport is, in viewport coordinates.
  navTop:Math.round(navTop*10)/10,
  viewportHeight:win.innerHeight??null,
  scrollY:Math.round(scrollY*10)/10,
  visible:box.width>MAP_MIN_EXTENT&&height>MAP_MIN_EXTENT,
 };
}

// Includes the document Y and the visible height. Anything that changes this key
// changes what the person sees, so the native frame must follow.
export function geometryKey(geometry){
 if(!geometry)return '';
 return [geometry.pageX??geometry.x,geometry.pageY,geometry.width,geometry.height].join(':');
}
export function sameGeometry(a,b){return Boolean(a)&&Boolean(b)&&geometryKey(a)===geometryKey(b);}
// Same place and width, different visible height: a sheet detent or a keyboard,
// which only needs the native frame moved/resized, never a content re-apply.
export function resizedOnly(a,b){
 if(!a||!b)return false;
 return a.x===b.x&&a.pageY===b.pageY&&a.width===b.width&&a.height!==b.height;
}

// Does the frame the native side reports (document coordinates) match what the page measures now?
// Within a point, so rounding never causes a correction.
export function frameMatches(frame,geometry,tolerance=1){
 if(!frame||!geometry)return true; // nothing reported (an older native layer): nothing to compare
 return Math.abs(frame.x-(geometry.pageX??geometry.x))<=tolerance&&Math.abs(frame.y-geometry.pageY)<=tolerance
  &&Math.abs(frame.width-geometry.width)<=tolerance&&Math.abs(frame.height-geometry.height)<=tolerance;
}
