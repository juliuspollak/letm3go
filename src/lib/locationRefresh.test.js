import {expect,it} from 'vitest';
import {refreshLabel} from './locationRefresh.js';

const person={userId:'ann',group:'friend',state:'stale',locationAt:1000};
const baseline=new Map([[person.userId,person]]);
const finished={baseline,readFailed:{}};

it('shows no result for out-of-scope people or people whose sharing has been disabled',()=>{
 const failed={...finished,requestFailed:true};
 expect(refreshLabel({...person,userId:'other'},failed)).toBe('');
 expect(refreshLabel({...person,state:'off'},failed)).toBe('');
});

it('uses each audience’s read result and replaces failures only with a newer observation',()=>{
 const member={...person,userId:'kim',group:'household'};
 const failed={baseline:new Map([...baseline,[member.userId,member]]),readFailed:{friend:true,household:false}};
 expect(refreshLabel(person,failed)).toBe('Couldn’t check');
 expect(refreshLabel({...person,locationAt:999},failed)).toBe('Couldn’t check');
 expect(refreshLabel({...person,locationAt:1001},failed)).toBe('New location');
 expect(refreshLabel({...person,locationAt:1001},{...finished,requestFailed:true})).toBe('New location');
 expect(refreshLabel(member,failed)).toBe('No new location');
});
