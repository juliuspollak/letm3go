import {expect,it,vi} from 'vitest';
vi.mock('@capacitor/core',()=>({Capacitor:{getPlatform:()=>'ios'},registerPlugin:()=>({})}));
import {snapshotKey,reconcileRecorderSnapshot} from './useRecorder.js';
const state={ownerID:'me',permission:'always',recordingHealth:{status:'ready',issues:[],motion:'authorized'}};
it('treats a recording-health change as new state, so an open app updates',()=>{
 const changed={...state,recordingHealth:{status:'limited',issues:['motionDenied'],motion:'denied'}};
 expect(snapshotKey(changed)).not.toBe(snapshotKey(state));
});
it('keeps an unchanged poll identical, so a health read causes no re-render',()=>{
 expect(snapshotKey({...state,recordingHealth:{...state.recordingHealth}})).toBe(snapshotKey(state));
});

it('retains history objects on live status updates and only replaces edited records',()=>{
 const a={id:'a',updatedAt:1,points:[{latitude:1,longitude:2}]},b={id:'b',updatedAt:1};
 const previous={ownerID:'me',trips:[a,b],places:[]};
 const poll=reconcileRecorderSnapshot(previous,{ownerID:'me',trips:[{...a},{...b}],places:[],sharedActivity:'walking'});
 expect(poll.trips).toBe(previous.trips);expect(poll.places).toBe(previous.places);
 const edited=reconcileRecorderSnapshot(previous,{ownerID:'me',trips:[{...a},{...b,updatedAt:2,title:'Edited'}]});
 expect(edited.trips[0]).toBe(a);expect(edited.trips[1]).not.toBe(b);
});
it('hydrates unchanged native history only for the matching account and token',()=>{
 const previous={ownerID:'me',historyToken:'token',trips:[{id:'watch',source:'watch'}]};
 expect(reconcileRecorderSnapshot(previous,{ownerID:'me',historyToken:'token',historyUnchanged:true,trips:[]}).trips).toBe(previous.trips);
 expect(()=>reconcileRecorderSnapshot(previous,{ownerID:'other',historyToken:'token',historyUnchanged:true})).toThrow('cache changed');
 expect(()=>reconcileRecorderSnapshot(previous,{ownerID:'me',historyToken:'different',historyUnchanged:true})).toThrow('cache changed');
});

it('refreshes an accepted Watch heart-rate result even from an older native build',()=>{
 const held={id:'watch',source:'watch',details:{unverifiedHeartRate:{samples:[{timestamp:100}]}}};
 const accepted={...held,details:{heartRate:{samples:[{timestamp:100}]}}};
 const result=reconcileRecorderSnapshot({ownerID:'me',trips:[held]},{ownerID:'me',trips:[accepted]});
 expect(result.trips[0]).toBe(accepted);
});
