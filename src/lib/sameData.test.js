import {describe,expect,it} from 'vitest';
import {keepIfSame,sameData} from './sameData.js';

describe('keepIfSame',()=>{
 it('keeps the value in state when a poll answers with the same content',()=>{
  const previous=[{user_id:'a',latitude:1}];
  expect(keepIfSame([{user_id:'a',latitude:1}])(previous)).toBe(previous);
 });
 it('takes the new value when anything changed',()=>{
  const next=[{user_id:'a',latitude:2}];
  expect(keepIfSame(next)([{user_id:'a',latitude:1}])).toBe(next);
  expect(sameData([],[{}])).toBe(false);
 });
});
