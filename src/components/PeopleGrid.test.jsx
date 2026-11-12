import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import PeopleGrid from './PeopleGrid.jsx';

afterEach(cleanup);
const person=over=>({id:'p',userId:'p',name:'Julia',status:{text:'At school',tone:'live'},...over});

it('tapping a person shows them on the Map and never pokes', ()=>{
 const open=vi.fn(),poke=vi.fn();
 render(<PeopleGrid people={[person({onSelect:open,onPoke:poke,actionLabel:'Show Julia on the Map.'})]} label="People"/>);
 fireEvent.click(screen.getByLabelText(/Show Julia on the Map/));
 expect(open).toHaveBeenCalledTimes(1);expect(poke).not.toHaveBeenCalled();
});
it('Poke is its own button under the status: it pokes once and never opens the Map', ()=>{
 const open=vi.fn(),poke=vi.fn();
 const {container}=render(<PeopleGrid people={[person({onSelect:open,onPoke:poke,actionLabel:'Show Julia on the Map.'})]} label="People"/>);
 const button=screen.getByRole('button',{name:'Poke Julia'});
 expect(button.textContent).toBe('👋 Poke');
 expect(button.closest('button.is-button')).toBeNull(); // not inside the tile's button
 fireEvent.click(button);
 expect(poke).toHaveBeenCalledTimes(1);expect(open).not.toHaveBeenCalled();
 // Order: avatar, name, status, then Poke.
 const wrap=container.querySelector('.person-tile-wrap');
 expect(wrap.lastElementChild).toBe(button);
});
it('shows the compact status line, and keeps the full wording for the screen reader', ()=>{
 render(<PeopleGrid people={[person({short:'2.6 km · 8m ago',status:{text:'Sharing · 8 min ago · 2.6 km away',tone:'live'},onSelect:vi.fn()})]} label="People"/>);
 expect(screen.getByText('2.6 km · 8m ago')).toBeTruthy();
 expect(screen.queryByText(/Sharing · 8 min/)).toBeNull();
 expect(screen.getByRole('button',{name:/Sharing · 8 min ago · 2.6 km away/})).toBeTruthy();
});
it('Poke: sending is disabled so it cannot double-send, then confirms, and a failure offers a retry', ()=>{
 const poke=vi.fn();
 const view=state=>render(<PeopleGrid people={[person({onSelect:vi.fn(),onPoke:poke,poke:state})]} label="People"/>);
 const sending=view({state:'sending'});
 const busy=screen.getByRole('button',{name:'Poking Julia'});
 expect(busy.disabled).toBe(true);expect(busy.textContent).toBe('Poking…');
 fireEvent.click(busy);expect(poke).not.toHaveBeenCalled();
 sending.unmount();
 const sent=view({state:'sent'});
 const done=screen.getByRole('button',{name:'Poked Julia'});expect(done.textContent).toBe('✓ Poked');
 fireEvent.click(done);expect(poke).not.toHaveBeenCalled(); // not again while it shows Poked
 sent.unmount();
 view({state:'failed',message:'Slow down'});
 const retry=screen.getByRole('button',{name:/Poke Julia failed: Slow down/});
 expect(retry.textContent).toBe('Retry poke');
 expect(screen.getByText('Slow down')).toBeTruthy(); // the reason is visible, not only spoken
 fireEvent.click(retry);expect(poke).toHaveBeenCalledTimes(1);
});
it('has no ••• menu, hold gesture, bubble or wiggle', ()=>{
 const {container}=render(<PeopleGrid people={[person({onSelect:vi.fn(),onPoke:vi.fn()})]} label="People"/>);
 expect(screen.queryByLabelText(/More actions/)).toBeNull();
 expect(container.querySelector('.poke-bubble,.person-more,.person-tile--poked')).toBeNull();
});
it('shows an incoming poke as a short line in the status place', ()=>{
 render(<PeopleGrid people={[person({short:'2.6 km · 8m ago',onSelect:vi.fn(),poke:{state:'received'}})]} label="People"/>);
 expect(screen.getByText('Poked you 👋')).toBeTruthy();
});
it('shows no poke control where poking is not offered',()=>{
 render(<PeopleGrid people={[person({onSelect:vi.fn()})]} label="People"/>);
 expect(screen.queryByRole('button',{name:/^Poke/})).toBeNull();
});
