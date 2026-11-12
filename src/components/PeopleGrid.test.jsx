import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import PeopleGrid,{HOLD_MS} from './PeopleGrid.jsx';

afterEach(cleanup);
const person=over=>({id:'p',userId:'p',name:'Julia',status:{text:'At school',tone:'live'},...over});

it('tapping a person shows them on the Map and never pokes', ()=>{
 const open=vi.fn(),poke=vi.fn();
 render(<PeopleGrid people={[person({onSelect:open,onPoke:poke,actionLabel:'Show Julia on the Map.'})]} label="People"/>);
 fireEvent.click(screen.getByLabelText(/Show Julia on the Map/));
 expect(open).toHaveBeenCalledTimes(1);expect(poke).not.toHaveBeenCalled();
});
const hold=(el,ms)=>{fireEvent.pointerDown(el,{button:0,clientX:5,clientY:5});act(()=>{vi.advanceTimersByTime(ms);});};
it('pokes after a press and hold, shaking while held, and does not open the Map', ()=>{
 vi.useFakeTimers();
 try{
  const open=vi.fn(),poke=vi.fn();
  render(<PeopleGrid people={[person({onSelect:open,onPoke:poke,actionLabel:'Show Julia on the Map.'})]} label="People"/>);
  const tile=screen.getByLabelText(/Show Julia on the Map/);
  hold(tile,300);
  expect(tile.className).toMatch(/is-holding/);expect(poke).not.toHaveBeenCalled();
  act(()=>{vi.advanceTimersByTime(HOLD_MS);});
  expect(poke).toHaveBeenCalledTimes(1);expect(tile.className).not.toMatch(/is-holding/);
  fireEvent.pointerUp(tile);fireEvent.click(tile);
  expect(open).not.toHaveBeenCalled();
  // The next ordinary tap still opens the Map.
  fireEvent.pointerDown(tile,{button:0,clientX:5,clientY:5});fireEvent.pointerUp(tile);fireEvent.click(tile);
  expect(open).toHaveBeenCalledTimes(1);expect(poke).toHaveBeenCalledTimes(1);
 }finally{vi.useRealTimers();}
});
it('letting go early, or moving away to scroll, neither pokes nor shakes on', ()=>{
 vi.useFakeTimers();
 try{
  const poke=vi.fn();
  render(<PeopleGrid people={[person({onSelect:vi.fn(),onPoke:poke,actionLabel:'Show Julia on the Map.'})]} label="People"/>);
  const tile=screen.getByLabelText(/Show Julia on the Map/);
  hold(tile,400);fireEvent.pointerUp(tile);
  act(()=>{vi.advanceTimersByTime(2000);});
  expect(poke).not.toHaveBeenCalled();expect(tile.className).not.toMatch(/is-holding/);
  hold(tile,100);fireEvent.pointerMove(tile,{clientX:5,clientY:60});
  act(()=>{vi.advanceTimersByTime(2000);});
  expect(poke).not.toHaveBeenCalled();
 }finally{vi.useRealTimers();}
});
it('gives assistive technology a Poke button, and has no ••• menu', ()=>{
 const poke=vi.fn();
 render(<PeopleGrid people={[person({onSelect:vi.fn(),onPoke:poke})]} label="People"/>);
 expect(screen.queryByLabelText(/More actions/)).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Poke Julia'}));
 expect(poke).toHaveBeenCalledTimes(1);
});
it('shows a poke result as a quiet line of text, with no bubble', ()=>{
 const {container}=render(<PeopleGrid people={[person({onSelect:vi.fn(),poke:{state:'received'}})]} label="People"/>);
 expect(screen.getByText('Poked you 👋')).toBeTruthy();
 expect(container.querySelector('.poke-bubble')).toBeNull();
});
it('shows no poke control where poking is not offered',()=>{
 render(<PeopleGrid people={[person({onSelect:vi.fn()})]} label="People"/>);
 expect(screen.queryByRole('button',{name:/^Poke/})).toBeNull();
});
