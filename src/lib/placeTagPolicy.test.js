import {expect,it} from 'vitest';
import {placeTagPolicy,rankPlaceCandidates} from './placeTagPolicy.js';
it('keeps driving tags focused on saved destinations and meaningful stops',()=>{
 const candidates=[{name:'Home',kind:'saved'},{name:'Shellharbour City Centre',kind:'destination'},...Array.from({length:15},(_,i)=>({name:'Roadside business '+i,kind:'route'})),{name:'Shopping',kind:'route'}];
 expect(rankPlaceCandidates(candidates,{activity:'Driving'}).map(x=>x.name)).toEqual(['Home','Shellharbour City Centre']);
 expect(placeTagPolicy('Driving').limit).toBe(3);
});
it('allows meaningful trail locations on a hike while suppressing generic route categories',()=>{
 const result=rankPlaceCandidates([{name:'Bushrangers Bay',kind:'route'},{name:'Bass Point Reserve',kind:'route'},{name:'Nature',kind:'route'},{name:'Lookout',kind:'route'}],{activity:'Hiking'});
 expect(result.map(x=>x.name)).toEqual(expect.arrayContaining(['Bushrangers Bay','Bass Point Reserve','Lookout']));
 expect(result.map(x=>x.name)).not.toContain('Nature');
});
it('honours skipped suggestions, prevents duplicates and caps proposed places',()=>{
 const suggestions=Array.from({length:15},(_,i)=>({name:'Trail '+i,kind:'route'}));
 const result=rankPlaceCandidates(suggestions,{activity:'Cycling',hidden:['Trail 0'],existing:['Trail 1']});
 expect(result).toHaveLength(6);
 expect(result.map(x=>x.name)).not.toContain('Trail 0');
 expect(result.map(x=>x.name)).not.toContain('Trail 1');
});
