import {act,renderHook,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {usePeoplePlaceLabels} from './usePeoplePlaceLabels.js';

const {lookup}=vi.hoisted(()=>({lookup:vi.fn()}));
vi.mock('./recorder.js',()=>({recorderAvailable:()=>true,recorder:{nearbyPeoplePlace:lookup}}));
const live={userId:'friend',locationAt:1000,position:{latitude:-34.18,longitude:150.91,accuracy:10},location:{state:'live',activity:'Driving'}};
const mount=people=>renderHook(props=>usePeoplePlaceLabels(props,{enabled:true,scope:'viewer'}),{initialProps:people});
beforeEach(()=>{lookup.mockReset();});

it('reuses a label inside the same area and refreshes after a drive moves to a different area',async()=>{
 lookup.mockResolvedValueOnce({label:'Princes Highway, Bulli'}).mockResolvedValueOnce({label:'Lawrence Hargrave Drive, Thirroul'});
 const {result,rerender}=mount([live]);
 await waitFor(()=>expect(result.current.friend).toBe('Princes Highway, Bulli'));
 await act(async()=>rerender([{...live,locationAt:2000,position:{...live.position,longitude:150.9101}}]));
 expect(lookup).toHaveBeenCalledTimes(1);
 rerender([{...live,locationAt:3000,position:{...live.position,longitude:150.92}}]);
 expect(result.current.friend).toBeUndefined();
 await waitFor(()=>expect(result.current.friend).toBe('Lawrence Hargrave Drive, Thirroul'));
 expect(lookup).toHaveBeenLastCalledWith(expect.objectContaining({moving:true,coarse:false}));
});

it('excludes saved locations and ignores lookups that finish after sharing stops',async()=>{
 let resolve;
 lookup.mockImplementation(()=>new Promise(done=>{resolve=done;}));
 const {result,rerender}=mount([{...live,location:{...live.location,placeName:'Work'}}]);
 expect(lookup).not.toHaveBeenCalled();
 rerender([live]);
 await waitFor(()=>expect(lookup).toHaveBeenCalledOnce());
 rerender([{...live,location:{state:'off'}}]);
 await act(async()=>resolve({label:'Bulli'}));
 expect(result.current).toEqual({});
});
