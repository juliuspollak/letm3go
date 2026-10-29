import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('../lib/supabase.js',()=>({supabase:mock}));
import Friends from './Friends.jsx';
import Household from './Household.jsx';
const photo='data:image/jpeg;base64,AAAA';
beforeEach(()=>{mock.rpc.mockImplementation(async name=>({data:name==='my_friends'?[{user_id:'person',display_name:'Alex'}]:name==='my_household'?[{id:'family',name:'Family',role:'owner'}]:name==='household_members'?[{user_id:'person',display_name:'Alex',role:'member'}]:null}));});
afterEach(cleanup);
it('renders the same person tile and authorised photo in Friends and Household',async()=>{
 const photos={person:photo};
 render(<><div data-testid="friends"><Friends personPhotos={photos}/></div><div data-testid="household"><Household personPhotos={photos}/></div></>);
 const tiles=[];
 for(const view of ['friends','household']){
  const avatar=await within(screen.getByTestId(view)).findByRole('img',{name:'Alex avatar'});
  expect(avatar).toHaveClass('person-avatar--lg');
  expect(avatar.querySelector('img')).toHaveAttribute('src',photo);
  tiles.push(avatar.closest('.person-tile'));
 }
 // One component for both screens: same structure, same classes.
 expect(tiles[0].className).toBe(tiles[1].className);
 const parts=tile=>[...tile.children].map(child=>child.classList[0]);
 expect(parts(tiles[0])).toEqual(parts(tiles[1]));
});
it('keeps removing a friend, now under Add friend',async()=>{
 render(<Friends/>);
 await screen.findByRole('img',{name:'Alex avatar'});
 expect(screen.queryByRole('button',{name:'Remove friend Alex'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Add friend'}));
 fireEvent.click(await screen.findByRole('button',{name:'Remove friend Alex'}));
 await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('remove_friend',{p_friend:'person'}));
});
it('shows the organiser their own profile photo even before the shared photo list arrives',async()=>{
 mock.rpc.mockImplementation(async name=>({data:name==='my_household'?[{id:'family',name:'Family',role:'owner'}]:name==='household_members'?[{user_id:'julius',display_name:'Julius',role:'owner'}]:null}));
 render(<Household personPhotos={{}} selfId="julius" selfAvatar={photo}/>);
 const avatar=await screen.findByRole('img',{name:'Julius avatar'});
 expect(avatar.querySelector('img')).toHaveAttribute('src',photo);
 expect(screen.getByText('Organiser')).toBeInTheDocument();
});
it('keeps every other member photo when only your own entry was missing',async()=>{
 mock.rpc.mockImplementation(async name=>({data:name==='my_household'?[{id:'family',name:'Family',role:'owner'}]:name==='household_members'?[{user_id:'julius',display_name:'Julius',role:'owner'},{user_id:'person',display_name:'Alex',role:'member'}]:null}));
 render(<Household personPhotos={{person:photo}} selfId="julius" selfAvatar={photo}/>);
 expect((await screen.findByRole('img',{name:'Julius avatar'})).querySelector('img')).toHaveAttribute('src',photo);
 expect(screen.getByRole('img',{name:'Alex avatar'}).querySelector('img')).toHaveAttribute('src',photo);
});
it('shows your profile first in Friends, with your sharing state',async()=>{
 render(<Friends selfName="Julius" selfId="julius" selfAvatar={photo} sharing={{enabled:false,ready:true,onChange:vi.fn()}}/>);
 const you=screen.getByRole('img',{name:'Julius avatar'}).closest('.person-tile');
 expect(you.querySelector('img')).toHaveAttribute('src',photo);
 expect(within(you).getByText('You')).toBeInTheDocument();
 expect(within(you).getByText('Not sharing')).toBeInTheDocument();
 await screen.findByRole('img',{name:'Alex avatar'});
});
