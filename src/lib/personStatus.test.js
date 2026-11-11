import {expect,it} from 'vitest';
import {personStatus,sinceText} from './personStatus.js';

const at=new Date('2026-11-11T08:46:00+11:00');
it('shows a friend\'s shared place with when they arrived, instead of an ageing last-seen',()=>{
 const since=new Date(at.getTime()).toISOString();
 expect(personStatus({state:'stale',ageSeconds:30*60,placeName:'School',placeSince:since}).text).toMatch(/^At School · since /);
 expect(personStatus({state:'stale',ageSeconds:30*60,placeName:'School',placeSince:since}).tone).toBe('live');
 expect(personStatus({state:'live',ageSeconds:30,placeName:'School'}).text).toBe('At School');
});
it('never names a place for someone with no position, and falls back to last seen without one',()=>{
 expect(personStatus({state:'off',placeName:'School'}).text).toBe('Not sharing');
 expect(personStatus({state:'stale',ageSeconds:7200}).text).toBe('Last seen 2 h ago');
});
it('adds the weekday when the stay began before today',()=>{
 const now=new Date('2026-11-11T12:00:00+11:00');
 expect(sinceText('2026-11-11T08:46:00+11:00',now)).toMatch(/^since \d/);
 expect(sinceText('2026-11-10T08:46:00+11:00',now)).toMatch(/^since [A-Z][a-z]{2} /);
 expect(sinceText('nonsense',now)).toBe('');
});
it('does not hide a long silence behind a place name',()=>{
 const text=personStatus({state:'stale',ageSeconds:5*3600,placeName:'School',placeSince:'2026-11-11T08:46:00+11:00'});
 expect(text.text).toMatch(/^At School · since .* · seen 5 h ago$/);
 expect(text.tone).toBe('stale');
 expect(personStatus({state:'stale',ageSeconds:20*60,placeName:'School'}).tone).toBe('live');
});
