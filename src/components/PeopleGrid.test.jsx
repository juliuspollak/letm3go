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
it('pokes only from the ••• menu, which does not open the Map', ()=>{
 const open=vi.fn(),poke=vi.fn();
 render(<PeopleGrid people={[person({onSelect:open,onPoke:poke,actionLabel:'Show Julia on the Map.'})]} label="People"/>);
 expect(screen.queryByRole('menu')).toBeNull();
 fireEvent.click(screen.getByLabelText('More actions for Julia'));
 fireEvent.click(screen.getByRole('menuitem',{name:'Poke Julia'}));
 expect(poke).toHaveBeenCalledTimes(1);expect(open).not.toHaveBeenCalled();
 expect(screen.queryByRole('menu')).toBeNull();
});
it('closes the menu on Escape and keeps it separate from the tile', ()=>{
 render(<PeopleGrid people={[person({onSelect:vi.fn(),onPoke:vi.fn()})]} label="People"/>);
 fireEvent.click(screen.getByLabelText('More actions for Julia'));
 expect(screen.getByRole('menu')).toBeTruthy();
 fireEvent.keyDown(document,{key:'Escape'});
 expect(screen.queryByRole('menu')).toBeNull();
 expect(screen.getByLabelText('More actions for Julia').closest('button.is-button')).toBeNull();
});
it('shows a poke result as a quiet line of text, with no bubble', ()=>{
 const {container}=render(<PeopleGrid people={[person({onSelect:vi.fn(),poke:{state:'received'}})]} label="People"/>);
 expect(screen.getByText('Poked you 👋')).toBeTruthy();
 expect(container.querySelector('.poke-bubble')).toBeNull();
});
it('shows no poke control where poking is not offered',()=>{
 render(<PeopleGrid people={[person({onSelect:vi.fn()})]} label="People"/>);
 expect(screen.queryByLabelText(/More actions/)).toBeNull();
});
it('closes the menu when focus leaves it', ()=>{
 render(<><PeopleGrid people={[person({onSelect:vi.fn(),onPoke:vi.fn()})]} label="People"/><button>elsewhere</button></>);
 const more=screen.getByLabelText('More actions for Julia');
 fireEvent.click(more);
 expect(screen.getByRole('menu')).toBeTruthy();
 fireEvent.blur(more,{relatedTarget:screen.getByText('elsewhere')});
 expect(screen.queryByRole('menu')).toBeNull();
});
