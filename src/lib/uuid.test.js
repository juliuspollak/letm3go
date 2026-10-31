import {afterEach,expect,it,vi} from 'vitest';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {newUUID} from './uuid.js';
import {newFeedbackToken} from './feedback.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
afterEach(()=>vi.unstubAllGlobals());
it('stays a real version 4 UUID on iOS before 15.4, which has no randomUUID',()=>{
 vi.stubGlobal('crypto',{getRandomValues:bytes=>bytes.fill(255)});
 expect(newUUID()).toMatch(UUID);
 expect(newFeedbackToken()).toMatch(UUID);
 vi.stubGlobal('crypto',undefined);
 expect(new Set(Array.from({length:50},newUUID)).size).toBe(50);
 expect(newUUID()).toMatch(UUID);
});
it('leaves no direct randomUUID call behind that would throw on those versions',()=>{
 const files=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(dir,e.name)):[join(dir,e.name)]);
 const direct=files('src').filter(f=>/\.jsx?$/.test(f)&&!/\.test\.|uuid\.js$/.test(f)&&readFileSync(f,'utf8').includes('randomUUID'));
 expect(direct).toEqual([]);
});
