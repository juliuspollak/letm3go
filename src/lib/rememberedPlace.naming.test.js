import {expect,it} from 'vitest';
import {namingPlace} from './rememberedPlace.js';
const at=(north=0)=>({latitude:-34.5+north/111195,longitude:150.85});
const place=(id,name,kind,north,radius)=>({id,name,kind,latitude:-34.5+north/111195,longitude:150.85,radius});
it('names a point after Home before a favourite on top of it, whatever order the places are in',()=>{
 const home=place('h','Home','home',0,100),park=place('p','Morley Park','favourite',8,200);
 expect(namingPlace([park,home],at(5)).name).toBe('Home');
 expect(namingPlace([home,park],at(5)).name).toBe('Home');
 // Out of Home's reach the favourite is the answer.
 expect(namingPlace([home,park],at(150)).name).toBe('Morley Park');
});
it('prefers the tighter place, then the nearer, then a stable one',()=>{
 const wide=place('w','Beach','favourite',0,500),small=place('s','Gym','favourite',0,40);
 expect(namingPlace([wide,small],at(10)).name).toBe('Gym');
 const near=place('n','Near','favourite',5,100),far=place('f','Far','favourite',60,100);
 expect(namingPlace([far,near],at(10)).name).toBe('Near');
 const a=place('a','A','favourite',0,100),b=place('b','B','favourite',0,100);
 expect(namingPlace([b,a],at(0)).id).toBe('a');
 expect(namingPlace([a,b],at(0)).id).toBe('a');
});
it('takes Home or Work over a tighter favourite inside them, and treats Work like Home',()=>{
 expect(namingPlace([place('c','Cafe','favourite',0,50),place('h','Home','home',0,150)],at(10)).name).toBe('Home');
 expect(namingPlace([place('c','Cafe','favourite',0,50),place('w','Work','work',0,150)],at(10)).name).toBe('Work');
});
it('names nothing outside every fence, without a usable point, or from a place without a name',()=>{
 expect(namingPlace([place('h','Home','home',0,100)],at(500))).toBeNull();
 expect(namingPlace([place('h','Home','home',0,100)],{latitude:NaN,longitude:1})).toBeNull();
 expect(namingPlace(undefined,at(0))).toBeNull();
 // An unnamed place never outranks a named one that contains the same point.
 expect(namingPlace([place('x','  ','home',0,100),place('g','Gym','favourite',0,200)],at(10)).name).toBe('Gym');
 expect(namingPlace([{id:'y',kind:'home',latitude:-34.5,longitude:150.85,radius:100}],at(10))).toBeNull();
 // A place without a radius counts as 150 m.
 expect(namingPlace([{id:'r',name:'Shed',kind:'favourite',latitude:-34.5,longitude:150.85}],at(120)).name).toBe('Shed');
});
