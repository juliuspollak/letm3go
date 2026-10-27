import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('../lib/supabase.js',()=>({supabase:mock}));
import Friends from './Friends.jsx';
import Household from './Household.jsx';
import HouseholdPresence from './HouseholdPresence.jsx';
const photo='data:image/jpeg;base64,AAAA';
beforeEach(()=>{mock.rpc.mockImplementation(async name=>({data:name==='my_friends'?[{user_id:'person',display_name:'Alex'}]:name==='my_household'?[{id:'family',name:'Family',role:'owner'}]:name==='household_members'?[{user_id:'person',display_name:'Alex',role:'member'}]:null}));});
afterEach(cleanup);
it('renders the same full bubble and authorized photo in Friends, Household, and live people',async()=>{
 const photos={person:photo};
 render(<><div data-testid="friends"><Friends personPhotos={photos}/></div><div data-testid="household"><Household personPhotos={photos}/></div><div data-testid="live"><HouseholdPresence personPhotos={photos} presence={{}} friendsLocation={{people:[{user_id:'person',display_name:'Alex',updated_at:'2026-10-27T00:00:00Z'}]}}/></div></>);
 for(const view of ['friends','household','live']){
  const avatar=await within(screen.getByTestId(view)).findByRole('img',{name:'Alex avatar'});
  expect(avatar).toHaveClass('person-avatar--lg');
  expect(avatar.closest('.person-bubble')).not.toBeNull();
  expect(avatar.querySelector('img')).toHaveAttribute('src',photo);
 }
});
it('preserves removing a friend after converting the row to a bubble',async()=>{
 render(<Friends/>);
 fireEvent.click(await screen.findByRole('button',{name:'Remove friend Alex'}));
 await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('remove_friend',{p_friend:'person'}));
});
it('shows a single live bubble for a person who is both a friend and household member',()=>{
 const person={user_id:'person',display_name:'Alex',updated_at:'2026-10-27T00:00:00Z'};
 render(<HouseholdPresence presence={{}} friendsLocation={{people:[person]}} householdLivePeople={[person]}/>);
 expect(screen.getAllByRole('img',{name:'Alex avatar'})).toHaveLength(1);
});
