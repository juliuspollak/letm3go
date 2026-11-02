import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import ActivitySheet from './ActivitySheet.jsx';
afterEach(cleanup);
const handle=()=>screen.getByRole('slider',{name:'Resize activity details'});

it('opens at the medium detent and keeps its content scrollable inside the sheet',()=>{
 render(<ActivitySheet><p>Ride notes</p></ActivitySheet>);
 expect(screen.getByRole('region',{name:'Activity details'})).toHaveAttribute('data-detent','medium');
 expect(screen.getByText('Ride notes')).toBeInTheDocument();
});

it('moves between the three detents from the keyboard without a pointer',()=>{
 const onDetentChange=vi.fn();
 render(<ActivitySheet onDetentChange={onDetentChange}><p>Ride notes</p></ActivitySheet>);
 fireEvent.keyDown(handle(),{key:'ArrowUp'});
 expect(screen.getByRole('region',{name:'Activity details'})).toHaveAttribute('data-detent','full');
 expect(handle()).toHaveAttribute('aria-valuetext','Expanded details');
 fireEvent.keyDown(handle(),{key:'ArrowDown'});
 fireEvent.keyDown(handle(),{key:'ArrowDown'});
 expect(screen.getByRole('region',{name:'Activity details'})).toHaveAttribute('data-detent','peek');
 expect(onDetentChange.mock.calls.map(call=>call[0])).toEqual(['full','medium','peek']);
});

it('never drags past the detents even when the finger keeps going',()=>{
 render(<ActivitySheet><p>Ride notes</p></ActivitySheet>);
 fireEvent.pointerDown(handle(),{clientY:200});
 fireEvent.pointerMove(handle(),{clientY:2000});
 fireEvent.pointerUp(handle(),{clientY:2000});
 expect(screen.getByRole('region',{name:'Activity details'})).toHaveAttribute('data-detent','peek');
 expect(Number(handle().getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(Number(handle().getAttribute('aria-valuemin')));
 // One flick moves exactly one detent, however far the finger travelled.
 fireEvent.pointerDown(handle(),{clientY:400});
 fireEvent.pointerMove(handle(),{clientY:-4000});
 fireEvent.pointerUp(handle(),{clientY:-4000});
 expect(screen.getByRole('region',{name:'Activity details'})).toHaveAttribute('data-detent','medium');
 expect(Number(handle().getAttribute('aria-valuenow'))).toBeLessThanOrEqual(Number(handle().getAttribute('aria-valuemax')));
});

it('tracks a pointer without a height transition and restores detent snapping on release',()=>{
 render(<ActivitySheet>Notes</ActivitySheet>);
 const sheet=screen.getByRole('region',{name:'Activity details'});
 expect(sheet.style.transition).toBe('');
 fireEvent.pointerDown(handle(),{clientY:300});
 expect(sheet.style.transition).toBe('none');
 fireEvent.pointerMove(handle(),{clientY:240});
 expect(sheet.style.transition).toBe('none');
 fireEvent.pointerUp(handle(),{clientY:240});
 expect(sheet.style.transition).toBe('');
});
