import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import SocialLocationRefresh from './SocialLocationRefresh.jsx';

afterEach(cleanup);

it('refreshes locations from the button and prevents duplicate requests',async()=>{
 let finish;
 const refresh=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
 render(<SocialLocationRefresh onRefresh={refresh}><p>People</p></SocialLocationRefresh>);
 fireEvent.click(screen.getByRole('button',{name:'Refresh locations'}));
 expect(screen.getByRole('button',{name:'Refreshing locations…'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Refreshing locations…'}));
 expect(refresh).toHaveBeenCalledOnce();
 finish();
 await waitFor(()=>expect(screen.getByRole('button',{name:'Refresh locations'})).toBeEnabled());
});

it('refreshes on a downward pull from the top and ignores horizontal swipes',async()=>{
 const refresh=vi.fn().mockResolvedValue(undefined);
 render(<SocialLocationRefresh onRefresh={refresh}><p>People</p></SocialLocationRefresh>);
 const people=screen.getByText('People');
 const pull=(x,y)=>{
  fireEvent.touchStart(people,{touches:[{clientX:20,clientY:100}]});
  fireEvent.touchEnd(people,{touches:[],changedTouches:[{clientX:x,clientY:y}]});
 };
 pull(160,180);
 expect(refresh).not.toHaveBeenCalled();
 pull(24,185);
 expect(refresh).toHaveBeenCalledOnce();
 await waitFor(()=>expect(screen.getByRole('button',{name:'Refresh locations'})).toBeEnabled());
});
