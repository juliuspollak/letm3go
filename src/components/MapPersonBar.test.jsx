import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import MapPersonBar from './MapPersonBar.jsx';

afterEach(cleanup);
const people=[
 {userId:'kim',name:'Kim',group:'household',short:'At home',ageText:'just now',status:{tone:'home'}},
 {userId:'ann',name:'Ann',group:'friend',short:'2.6 km · 8m ago',ageText:'8m ago',status:{tone:'live'}},
 {userId:'lee',name:'Lee',group:'friend',short:'Not sharing',ageText:'',status:{tone:'off'}},
];
const bar=(over={})=>{const onSelect=vi.fn();render(<MapPersonBar people={people} selected={null} viewer="me" onSelect={onSelect} {...over}/>);return onSelect;};

it('shows one compact selector, not a row of people', ()=>{
 bar();
 expect(screen.getByRole('button',{name:/Showing All people/})).toBeTruthy();
 expect(screen.queryByText('Kim')).toBeNull();expect(screen.queryByText('Ann')).toBeNull();
 expect(screen.queryByRole('dialog')).toBeNull();
});
it('opens a list of All people, Me, household and friends, and choosing closes it', ()=>{
 const onSelect=bar();
 fireEvent.click(screen.getByRole('button',{name:/Showing All people/}));
 const sheet=screen.getByRole('dialog',{name:'Choose who to show'});
 expect(within(sheet).getByRole('region',{name:'Household'})).toBeTruthy();
 expect(within(within(sheet).getByRole('region',{name:'Household'})).getByText('Kim')).toBeTruthy();
 expect(within(within(sheet).getByRole('region',{name:'Friends'})).getAllByRole('button')).toHaveLength(2);
 expect(within(sheet).getByText('2.6 km · 8m ago')).toBeTruthy();
 fireEvent.click(within(sheet).getByRole('button',{name:/Ann/}));
 expect(onSelect).toHaveBeenCalledWith('ann');
 expect(screen.queryByRole('dialog')).toBeNull();
});
it('works for All people, Me and a person, marks the current choice, and the choice shows on the selector', ()=>{
 const onSelect=bar();
 fireEvent.click(screen.getByRole('button',{name:/Showing All people/}));
 expect(screen.getByRole('button',{name:/All people/,pressed:true})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:/^Me/}));
 expect(onSelect).toHaveBeenLastCalledWith('me');
 cleanup();
 bar({selected:'ann'});
 const trigger=screen.getByRole('button',{name:/Showing Ann, Updated 8m ago/});
 expect(trigger.textContent).toContain('Updated 8m ago');
 fireEvent.click(trigger);
 expect(screen.getByRole('button',{name:/^Ann/,pressed:true})).toBeTruthy();
});
it('is reachable from the keyboard: Escape closes it, and focus returns to the selector', ()=>{
 bar();
 const trigger=screen.getByRole('button',{name:/Showing All people/});
 fireEvent.click(trigger);
 expect(screen.getByRole('button',{name:'Close'})).toBeTruthy();
 fireEvent.keyDown(document,{key:'Escape'});
 expect(screen.queryByRole('dialog')).toBeNull();
 expect(document.activeElement).toBe(trigger);
});
it('handles twenty people', ()=>{
 const many=Array.from({length:20},(_,i)=>({userId:'p'+i,name:'Person '+i,group:i<5?'household':'friend',short:'Not sharing',status:{tone:'off'}}));
 bar({people:many});
 fireEvent.click(screen.getByRole('button',{name:/Showing All people/}));
 expect(screen.getAllByRole('button',{name:/Person \d+/})).toHaveLength(20);
});
it('puts the map key behind a small info button, only for a person', ()=>{
 bar();
 expect(screen.queryByRole('button',{name:'Map key'})).toBeNull();
 cleanup();
 bar({selected:'ann'});
 fireEvent.click(screen.getByRole('button',{name:'Map key'}));
 const key=screen.getByRole('dialog',{name:'Map key'});
 expect(within(key).getByText('Recorded GPS')).toBeTruthy();
 expect(within(key).getByText(/Estimated road/)).toBeTruthy();
});
it('keeps the selected person\'s name when they are no longer in the list, and returns focus to the key button', ()=>{
 bar({selected:'gone',selectedName:'Zoe'});
 expect(screen.getByRole('button',{name:/Showing Zoe/})).toBeTruthy();
 const keyButton=screen.getByRole('button',{name:'Map key'});
 fireEvent.click(keyButton);
 fireEvent.keyDown(document,{key:'Escape'});
 expect(document.activeElement).toBe(keyButton);
});
