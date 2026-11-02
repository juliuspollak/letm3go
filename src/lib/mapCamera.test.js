import {describe,expect,it} from 'vitest';
import {cameraReducer,initialCamera,shouldFocusSelf} from './mapCamera.js';

describe('focusing on your own position',()=>{
 const ready={visible:true,hasPosition:true};
 it('moves to you the first time',()=>expect(shouldFocusSelf(initialCamera,ready)).toBe(true));
 it('waits for a position and a visible map',()=>{
  expect(shouldFocusSelf(initialCamera,{...ready,hasPosition:false})).toBe(false);
  expect(shouldFocusSelf(initialCamera,{...ready,visible:false})).toBe(false);
 });
 it('never overrides a person or view already asked for',()=>{
  expect(shouldFocusSelf(cameraReducer(initialCamera,{type:'focus',personId:'friend'}),ready)).toBe(false);
  expect(shouldFocusSelf(cameraReducer(initialCamera,{type:'showAll'}),ready)).toBe(false);
 });
 it('never overrides a map the person already moved',()=>{
  expect(shouldFocusSelf(cameraReducer(initialCamera,{type:'native',mode:'free',command:1}),ready)).toBe(false);
 });
});
