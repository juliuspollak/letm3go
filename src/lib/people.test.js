import {describe,expect,it} from 'vitest';
import {connectedPeople,invitableFriends} from './people.js';

const friend=(user_id,display_name=user_id)=>({user_id,display_name});
describe('one list of people',()=>{
 it('includes household members who were never added as friends',()=>{
  expect(connectedPeople({household:[friend('kim')],selfID:'me'})).toEqual([{id:'kim',name:'kim',friend:false,household:true}]);
 });
 it('shows someone who is both once',()=>{
  expect(connectedPeople({friends:[friend('kim')],household:[friend('kim')]})).toEqual([{id:'kim',name:'kim',friend:true,household:true}]);
 });
 it('leaves you out',()=>{
  expect(connectedPeople({household:[friend('me'),friend('kim')],selfID:'me'}).map(person=>person.id)).toEqual(['kim']);
 });
 it('sorts by name',()=>{
  expect(connectedPeople({friends:[friend('Zed')],household:[friend('Ann')]}).map(person=>person.name)).toEqual(['Ann','Zed']);
 });
});
describe('friends who can join a household',()=>{
 it('leaves out members and marks who has been invited',()=>{
  expect(invitableFriends({friends:[friend('a'),friend('b'),friend('c')],members:[friend('a')],invited:['c']}).map(({user_id,invited})=>[user_id,invited])).toEqual([['b',false],['c',true]]);
 });
});
