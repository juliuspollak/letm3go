import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import PeopleGrid from './PeopleGrid.jsx';

afterEach(cleanup);
const person=over=>({id:'p',userId:'p',name:'Julia',status:{text:'At school',tone:'live'},...over});

it('tapping a person opens their map; poking is a separate, labelled control',()=>{
 const open=vi.fn(),poke=vi.fn();
 render(<PeopleGrid people={[person({onSelect:open,onPoke:poke,actionLabel:'Open Julia map.'})]} label="People"/>);
 fireEvent.click(screen.getByLabelText(/Open Julia map/));
 expect(open).toHaveBeenCalledTimes(1);expect(poke).not.toHaveBeenCalled();
 fireEvent.click(screen.getByLabelText('Poke Julia.'));
 expect(poke).toHaveBeenCalledTimes(1);expect(open).toHaveBeenCalledTimes(1);
});
it('shows no poke control where poking is not offered',()=>{
 render(<PeopleGrid people={[person({onSelect:vi.fn()})]} label="People"/>);
 expect(screen.queryByLabelText(/Poke/)).toBeNull();
});
