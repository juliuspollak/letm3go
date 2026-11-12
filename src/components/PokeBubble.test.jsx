import {act,cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import PeopleGrid from './PeopleGrid.jsx';
import PokeOverlay from './PokeOverlay.jsx';
afterEach(()=>{cleanup();vi.useRealTimers();});

const person=extra=>({id:'ann',userId:'ann',name:'Ann',status:{text:'Sharing · just now',tone:'live'},onSelect:()=>{},actionLabel:'Poke Ann.',...extra});

it('shows the result of a poke on the button itself, not as a bubble, wiggle or banner',()=>{
 const {container}=render(<PeopleGrid people={[person({onPoke:()=>{},poke:{state:'sent'}})]} label="Friends"/>);
 expect(screen.getByRole('button',{name:'Poked Ann'})).toHaveTextContent('✓ Poked');
 expect(container.querySelector('.poke-bubble,.person-tile--poked,.poke-layer')).toBeNull();
});
it('says "Poked you" for an incoming poke in the status place',()=>{
 render(<PeopleGrid people={[person({poke:{state:'received'}})]} label="Friends"/>);
 expect(screen.getByText('Poked you 👋')).toBeTruthy();
});
it('shows nothing extra for a person nobody poked',()=>{
 render(<PeopleGrid people={[person()]} label="Friends"/>);
 expect(screen.queryByRole('status')).toBeNull();
});
it('shows an incoming poke as a bubble by the profile unless the sender\'s avatar already shows it, and always dismisses',()=>{
 vi.useFakeTimers();
 const dismiss=vi.fn();
 const poke={body:'Ann poked you 👋'};
 const {rerender,container}=render(<PokeOverlay poke={poke} onDismiss={dismiss}/>);
 expect(container.querySelector('.poke-float')).toHaveTextContent('Ann poked you');
 expect(container.querySelector('.poke-layer')).toBeNull();
 rerender(<PokeOverlay poke={poke} quiet onDismiss={dismiss}/>);
 expect(container.querySelector('.poke-float')).toBeNull();
 act(()=>{vi.advanceTimersByTime(4000);});
 expect(dismiss).toHaveBeenCalled();
});
