// Detent maths for the activity details sheet. Kept pure so drags, snapping,
// rotation and keyboard resizing can be tested without a browser, and so the
// sheet and the map agree on exactly how much of the map stays visible.
export const SHEET_DETENTS=['peek','medium','full'];
export const SHEET_FRACTIONS={peek:0.32,medium:0.56,full:0.82};
// The map must keep a usable amount of visible height at every detent; the map is
// the background layer, never a 60-pixel strip behind the sheet.
export const MAP_MIN_VISIBLE=140;
export const SHEET_MIN_HEIGHT=180;

export function sheetHeight(detent,viewportHeight){
 const viewport=Math.max(320,Number(viewportHeight)||0);
 const fraction=SHEET_FRACTIONS[detent]??SHEET_FRACTIONS.medium;
 const max=Math.max(SHEET_MIN_HEIGHT,viewport-MAP_MIN_VISIBLE);
 return Math.round(Math.min(max,Math.max(SHEET_MIN_HEIGHT,viewport*fraction)));
}
// Height while a finger is down: clamped, never snapped, so the drag is smooth.
export function dragHeight(startHeight,startY,currentY,viewportHeight){
 const viewport=Math.max(320,Number(viewportHeight)||0);
 const max=Math.max(SHEET_MIN_HEIGHT,viewport-MAP_MIN_VISIBLE);
 return Math.round(Math.min(max,Math.max(SHEET_MIN_HEIGHT,startHeight+(startY-currentY))));
}
export function nearestDetent(height,viewportHeight,detents=SHEET_DETENTS){
 let best=detents[0],distance=Infinity;
 for(const detent of detents){
  const gap=Math.abs(sheetHeight(detent,viewportHeight)-height);
  if(gap<distance){best=detent;distance=gap;}
 }
 return best;
}
export const detentIndex=(detent,detents=SHEET_DETENTS)=>Math.max(0,detents.indexOf(detent));
export function adjacentDetent(detent,direction,detents=SHEET_DETENTS){
 const next=detentIndex(detent,detents)+(direction>0?1:-1);
 return detents[Math.min(detents.length-1,Math.max(0,next))];
}
// A drag that ends quickly is a flick even if it did not reach the next detent:
// the velocity decides, which is what makes the sheet feel native.
export function settleDetent({startHeight,currentHeight,viewportHeight,velocity=0,detents=SHEET_DETENTS}){
 if(Math.abs(velocity)>600)return adjacentDetent(nearestDetent(startHeight,viewportHeight,detents),velocity,detents);
 return nearestDetent(currentHeight,viewportHeight,detents);
}
// Only the height is exposed to CSS; the sheet never sets inline positions, so
// rotation and safe-area changes re-flow without extra JavaScript.
export function sheetStyle(height){return {'--activity-sheet-height':`${Math.round(height)}px`};}
