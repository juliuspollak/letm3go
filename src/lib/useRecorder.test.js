import {expect,it,vi} from 'vitest';
vi.mock('@capacitor/core',()=>({Capacitor:{getPlatform:()=>'ios'},registerPlugin:()=>({})}));
import {snapshotKey} from './useRecorder.js';
const state={ownerID:'me',permission:'always',recordingHealth:{status:'ready',issues:[],motion:'authorized'}};
it('treats a recording-health change as new state, so an open app updates',()=>{
 const changed={...state,recordingHealth:{status:'limited',issues:['motionDenied'],motion:'denied'}};
 expect(snapshotKey(changed)).not.toBe(snapshotKey(state));
});
it('keeps an unchanged poll identical, so a health read causes no re-render',()=>{
 expect(snapshotKey({...state,recordingHealth:{...state.recordingHealth}})).toBe(snapshotKey(state));
});
