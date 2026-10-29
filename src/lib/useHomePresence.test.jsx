import {cleanup,renderHook} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {useHomePresence} from './useHomePresence.js';
afterEach(cleanup);

const home={id:'home',latitude:-33.87,longitude:151.21,radius:100};
const inside={latitude:-33.87,longitude:151.2109,accuracy:10};
const edge={latitude:-33.87,longitude:151.21118,accuracy:10};
const away={latitude:-33.87,longitude:151.213,accuracy:10};

it('keeps someone at Home across the boundary until they clearly leave, without flickering',()=>{
 const {result,rerender}=renderHook(({point,eligible=true})=>useHomePresence([{id:'anna',eligible,point}],home),{initialProps:{point:edge}});
 expect(result.current.anna).toBe(false);
 rerender({point:inside});
 expect(result.current.anna).toBe(true);
 rerender({point:edge});
 expect(result.current.anna).toBe(true);
 rerender({point:away});
 expect(result.current.anna).toBe(false);
 rerender({point:edge});
 expect(result.current.anna).toBe(false);
});
it('never places a stale (ineligible) position at Home, and needs a saved Home',()=>{
 const {result,rerender}=renderHook(({eligible,place})=>useHomePresence([{id:'anna',eligible,point:inside}],place),{initialProps:{eligible:false,place:home}});
 expect(result.current.anna).toBe(false);
 rerender({eligible:true,place:null});
 expect(result.current.anna).toBe(false);
 rerender({eligible:true,place:home});
 expect(result.current.anna).toBe(true);
});
it('returns the same flags object while nothing changes, so the map does not rebuild',()=>{
 const people=[{id:'anna',eligible:true,point:inside}];
 const {result,rerender}=renderHook(({list})=>useHomePresence(list,home),{initialProps:{list:people}});
 const first=result.current;
 rerender({list:[{id:'anna',eligible:true,point:{...inside}}]});
 expect(result.current).toBe(first);
});
