import {describe,expect,it} from 'vitest';
import {frameMatches,geometryKey,resizedOnly,sameGeometry,surfaceGeometry} from './mapViewport.js';

function surface(box){
 return {getBoundingClientRect:()=>box};
}
function win({scrollY=0,navTop=null,innerHeight=800}={}){
 const nav=navTop==null?null:{getBoundingClientRect:()=>({top:navTop})};
 return {
  scrollY,innerHeight,
  document:{querySelector:selector=>selector==='.mobile-nav'?nav:null},
  getComputedStyle:()=>({display:navTop==null?'none':'flex'}),
 };
}

describe('native map placeholder geometry',()=>{
 it('reports the same document position while the page scrolls',()=>{
  const box={x:10,y:120,top:120,bottom:470,left:10,right:710,width:700,height:350};
  const before=surfaceGeometry(surface(box),win({scrollY:0}));
  const after=surfaceGeometry(surface({...box,y:-80,top:-80,bottom:270}),win({scrollY:200}));
  expect(geometryKey(before)).toBe(geometryKey(after));
  expect(sameGeometry(before,after)).toBe(true);
  expect(before.pageY).toBe(120);
  expect(after.pageY).toBe(120);
 });
 it('treats a sheet detent as a resize of the same map',()=>{
  const wide={x:10,y:120,top:120,bottom:470,left:10,right:710,width:700,height:350};
  const short={x:10,y:120,top:120,bottom:320,left:10,right:710,width:700,height:200};
  const a=surfaceGeometry(surface(wide),win());
  const b=surfaceGeometry(surface(short),win());
  expect(sameGeometry(a,b)).toBe(false);
  expect(resizedOnly(a,b)).toBe(true);
 });
 it('stops the map above the bottom navigation and reports when it is invisible',()=>{
  const box={x:10,y:600,top:600,bottom:900,left:10,right:710,width:700,height:300};
  const geometry=surfaceGeometry(surface(box),win({navTop:760}));
  expect(geometry.height).toBe(152);
  expect(geometry.visible).toBe(true);
  const hidden=surfaceGeometry(surface({...box,bottom:0,height:0}),win());
  expect(hidden.visible).toBe(false);
  const tiny=surfaceGeometry(surface({...box,width:40}),win());
  expect(tiny.visible).toBe(false);
 });
 it('returns nothing instead of throwing when there is no surface or window',()=>{
  expect(surfaceGeometry(null,win())).toBeNull();
  expect(surfaceGeometry(surface({x:0,y:0,width:1,height:1,top:0,bottom:1}),null)).toBeNull();
  expect(geometryKey(null)).toBe('');
  expect(sameGeometry(null,null)).toBe(false);
  expect(resizedOnly(null,null)).toBe(false);
 });
});

describe('document coordinates and the frame check',()=>{
 const box={x:16,y:96,top:96,bottom:616,left:16,right:359,width:343,height:520};
 it('adds the page\'s own scroll position to the viewport position, at the same moment',()=>{
  const g=surfaceGeometry(surface(box),win({scrollY:300,innerHeight:1400}));
  expect(g).toMatchObject({x:16,y:96,pageX:16,pageY:396,scrollY:300});
  // The page clamped to the top and the placeholder is where it was in the document.
  const clamped=surfaceGeometry(surface({...box,y:396,top:396,bottom:916}),win({scrollY:0,innerHeight:1400}));
  expect(clamped.pageY).toBe(396);expect(geometryKey(g)).toBe(geometryKey(clamped));
 });
 it('stops the frame above the tab bar and reports where that is',()=>{
  const g=surfaceGeometry(surface({...box,height:900,bottom:996}),win({navTop:700,scrollY:50}));
  expect(g.height).toBe(596); // 700 - 96 - 8
  expect(g.navTop).toBe(700);expect(g.pageY+g.height).toBeLessThanOrEqual(700+50);
 });
 it('compares what the native side reports with what the page measures, within a point',()=>{
  const g=surfaceGeometry(surface(box),win({scrollY:0}));
  expect(frameMatches({x:16,y:96,width:343,height:520},g)).toBe(true);
  expect(frameMatches({x:16.4,y:96.6,width:343,height:520},g)).toBe(true);
  expect(frameMatches({x:16,y:496,width:343,height:520},g)).toBe(false); // 400 pt too low
  expect(frameMatches(undefined,g)).toBe(true);expect(frameMatches({x:1,y:1,width:1,height:1},null)).toBe(true);
 });
});
