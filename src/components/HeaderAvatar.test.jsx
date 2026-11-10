import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import HeaderAvatar from './HeaderAvatar.jsx';
import NotificationList from './NotificationList.jsx';
vi.mock('../lib/supabase.js',()=>({supabase:null}));

let animate,reduce=false;
beforeEach(()=>{
 animate=vi.fn();reduce=false;
 HTMLElement.prototype.animate=animate;
 window.matchMedia=vi.fn(query=>({matches:reduce&&query.includes('reduce'),media:query}));
});
afterEach(()=>{cleanup();delete HTMLElement.prototype.animate;});

it('shows the unread count at the lower right of the avatar, as 9+ above nine',()=>{
 const {rerender}=render(<HeaderAvatar count={3} onOpen={()=>{}}><span>A</span></HeaderAvatar>);
 expect(screen.getByRole('button',{name:'Open profile, 3 new notifications'})).toHaveTextContent('3');
 rerender(<HeaderAvatar count={12} onOpen={()=>{}}><span>A</span></HeaderAvatar>);
 expect(screen.getByRole('button',{name:'Open profile, 12 new notifications'}).querySelector('.notification-badge')).toHaveTextContent('9+');
 rerender(<HeaderAvatar count={0} onOpen={()=>{}}><span>A</span></HeaderAvatar>);
 expect(screen.getByRole('button',{name:'Open profile'}).querySelector('.notification-badge')).toBeNull();
});

it('wiggles once when new notifications arrive, never when they are read, and opens Profile',()=>{
 const onOpen=vi.fn();
 const {rerender}=render(<HeaderAvatar count={0} onOpen={onOpen}><span>A</span></HeaderAvatar>);
 expect(animate).not.toHaveBeenCalled();
 rerender(<HeaderAvatar count={2} onOpen={onOpen}><span>A</span></HeaderAvatar>);
 expect(animate).toHaveBeenCalledTimes(1);
 expect(animate.mock.calls[0][1]).toMatchObject({iterations:1});
 rerender(<HeaderAvatar count={2} onOpen={onOpen}><span>A</span></HeaderAvatar>);
 rerender(<HeaderAvatar count={1} onOpen={onOpen}><span>A</span></HeaderAvatar>);
 expect(animate).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button'));expect(onOpen).toHaveBeenCalled();
});

it('does not wiggle with Reduce Motion on',()=>{
 reduce=true;
 const {rerender}=render(<HeaderAvatar count={0} onOpen={()=>{}}><span>A</span></HeaderAvatar>);
 rerender(<HeaderAvatar count={4} onOpen={()=>{}}><span>A</span></HeaderAvatar>);
 expect(animate).not.toHaveBeenCalled();
});

it('opens a notification where it belongs and marks only that one read',()=>{
 const onOpen=vi.fn(),onRead=vi.fn();
 const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const items=[{id:7,kind:'segment_pb',title:'New personal best',body:'Grove climb: 00:01:35',route:{screen:'segment',id},created_at:'2026-11-10T01:00:00Z'},
  {id:8,kind:'feedback_reply',title:'Reply to your feedback',body:'Fixed',route:{screen:'feedback',id},created_at:'2026-11-10T00:00:00Z'}];
 render(<NotificationList items={items} onOpen={onOpen} onRead={onRead}/>);
 fireEvent.click(screen.getByRole('button',{name:/New personal best/}));
 expect(onRead).toHaveBeenCalledWith(7);expect(onOpen).toHaveBeenCalledWith({screen:'segment',id});
 fireEvent.click(screen.getByRole('button',{name:/Reply to your feedback/}));
 expect(onOpen).toHaveBeenLastCalledWith({screen:'feedback',id});
});

it('says when there is nothing new',()=>{
 render(<NotificationList items={[]} onOpen={()=>{}} onRead={()=>{}}/>);
 expect(screen.getByText('No new notifications.')).toBeInTheDocument();
});
