import {describe,expect,it} from 'vitest';
import {geometryKey,resizedOnly,sameGeometry,surfaceGeometry} from './mapViewport.js';

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
 it('an overlay map host uses its full height and ignores the bottom navigation',()=>{
  const box={x:0,y:0,top:0,bottom:800,left:0,right:400,width:400,height:800};
  const geometry=surfaceGeometry(surface(box),win({navTop:700}),true);
  expect(geometry.height).toBe(800);
  expect(geometry.visible).toBe(true);
 });
 it('returns nothing instead of throwing when there is no surface or window',()=>{
  expect(surfaceGeometry(null,win())).toBeNull();
  expect(surfaceGeometry(surface({x:0,y:0,width:1,height:1,top:0,bottom:1}),null)).toBeNull();
  expect(geometryKey(null)).toBe('');
  expect(sameGeometry(null,null)).toBe(false);
  expect(resizedOnly(null,null)).toBe(false);
 });
});
