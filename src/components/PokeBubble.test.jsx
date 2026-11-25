import {act,cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import PeopleGrid from './PeopleGrid.jsx';
import PokeOverlay from './PokeOverlay.jsx';
afterEach(()=>{cleanup();vi.useRealTimers();});

const person=extra=>({id:'ann',userId:'ann',name:'Ann',status:{text:'Sharing · just now',tone:'live'},onSelect:()=>{},actionLabel:'Poke Ann.',...extra});

it('shows the result of a poke on the button itself, not as a bubble, wiggle or banner',()=>{
 const {container}=render(<PeopleGrid people={[person({onPoke:()=>{},poke:{state:'sent'}})]} label="Friends"/>);
 expect(screen.getByRole('button',{name:'Wave sent to Ann'})).toHaveAttribute('aria-disabled','true');
 expect(container.querySelector('.poke-bubble,.person-tile--poked,.poke-layer')).toBeNull();
});
it('announces an incoming wave and shows it on the avatar',()=>{
 render(<PeopleGrid people={[person({receivedPoke:true})]} label="Friends"/>);
 expect(screen.getByText('Ann waved at you')).toBeTruthy();
});
it('shows nothing extra for a person nobody poked',()=>{
 render(<PeopleGrid people={[person()]} label="Friends"/>);
 expect(screen.getAllByRole('status').every(status=>!status.textContent)).toBe(true);
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
