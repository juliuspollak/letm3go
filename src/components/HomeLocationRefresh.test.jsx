import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import HomeLocationRefresh from './HomeLocationRefresh.jsx';

afterEach(cleanup);

const pull=(target,x,y)=>{
 fireEvent.touchStart(target,{touches:[{clientX:20,clientY:100}]});
 fireEvent.touchEnd(target,{touches:[],changedTouches:[{clientX:x,clientY:y}]});
};

it('shows progress without a button and ignores another pull while refreshing',async()=>{
 let finish;
 const refresh=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
 render(<HomeLocationRefresh enabled onRefresh={refresh}><p>People</p></HomeLocationRefresh>);
 const people=screen.getByText('People');
 expect(screen.queryByRole('button')).toBeNull();
 pull(people,24,185);
 expect(screen.getByRole('status')).toHaveTextContent('Refreshing locations…');
 pull(people,24,185);
 expect(refresh).toHaveBeenCalledOnce();
 finish();
 await waitFor(()=>expect(screen.queryByRole('status')).toBeNull());
});

it('refreshes on a downward pull from the top and ignores horizontal swipes',async()=>{
 const refresh=vi.fn().mockResolvedValue(undefined);
 render(<HomeLocationRefresh enabled onRefresh={refresh}><p>People</p></HomeLocationRefresh>);
 const people=screen.getByText('People');
 pull(people,160,180);
 expect(refresh).not.toHaveBeenCalled();
 pull(people,24,185);
 expect(refresh).toHaveBeenCalledOnce();
 await waitFor(()=>expect(screen.queryByRole('status')).toBeNull());
});

it('moves the page during a pull and springs back without refreshing on a short pull',()=>{
 const refresh=vi.fn();
 render(<HomeLocationRefresh enabled onRefresh={refresh}><p>People</p></HomeLocationRefresh>);
 const target=screen.getByText('People');
 const page=screen.getByRole('main');
 fireEvent.touchStart(target,{touches:[{clientX:20,clientY:100}]});
 fireEvent.touchMove(target,{touches:[{clientX:21,clientY:145}]});
 expect(page).toHaveAttribute('data-pulling','true');
 expect(Number.parseFloat(page.style.getPropertyValue('--home-pull-offset'))).toBeCloseTo(35.1);
 expect(document.querySelector('.home-pull-reveal')).toHaveStyle({'--home-pull-offset':'35.1px'});
 expect(document.querySelector('.home-pull-indicator')).toHaveAttribute('data-ready','false');
 fireEvent.touchEnd(target,{touches:[],changedTouches:[{clientX:21,clientY:145}]});
 expect(refresh).not.toHaveBeenCalled();
 expect(page).not.toHaveAttribute('data-offset');
 expect(document.querySelector('.home-pull-indicator')).toBeNull();
});
