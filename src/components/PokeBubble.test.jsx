import {act,cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import PeopleGrid from './PeopleGrid.jsx';
import PokeOverlay from './PokeOverlay.jsx';
afterEach(()=>{cleanup();vi.useRealTimers();});

const person=extra=>({id:'ann',userId:'ann',name:'Ann',status:{text:'Sharing · just now',tone:'live'},onSelect:()=>{},actionLabel:'Poke Ann.',...extra});

it('shows a poke sent as a quiet line of text under the person, not a bubble, wiggle or banner',()=>{
 const {container}=render(<PeopleGrid people={[person({poke:{state:'sent'}})]} label="Friends"/>);
 expect(screen.getByRole('status')).toHaveTextContent('Poked ✓');
 expect(container.querySelector('.poke-bubble,.person-tile--poked,.poke-layer')).toBeNull();
});
it('says "Poked you" for an incoming poke and shows failures in the same line',()=>{
 const {rerender}=render(<PeopleGrid people={[person({poke:{state:'received'}})]} label="Friends"/>);
 expect(screen.getByRole('status')).toHaveTextContent('Poked you 👋');
 rerender(<PeopleGrid people={[person({poke:{state:'failed',message:'Slow down'}})]} label="Friends"/>);
 expect(screen.getByRole('status')).toHaveTextContent('Couldn’t poke');
 expect(screen.getByRole('status')).toHaveTextContent('Slow down');
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
