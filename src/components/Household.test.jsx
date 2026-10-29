import { render,screen,cleanup,fireEvent,waitFor } from '@testing-library/react';
import { afterEach,it,expect,vi } from 'vitest';
const m=vi.hoisted(()=>({rpc:vi.fn()}));vi.mock('../lib/supabase.js',()=>({supabase:m}));
import Household from './Household.jsx';
afterEach(cleanup);
it('reports failed initial status instead of pretending no membership exists',async()=>{m.rpc.mockResolvedValue({error:{status:503}});render(<Household/>);expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');});
it('confirms leaving and updates membership only after backend acknowledgement',async()=>{m.rpc.mockImplementation(async method=>method==='my_household'?{data:[{id:'h',name:'Family',role:'member'}]}:{data:null,error:null});render(<Household/>);fireEvent.click(await screen.findByRole('button',{name:'Settings'}));fireEvent.click(screen.getByRole('button',{name:'Leave household'}));expect(m.rpc).not.toHaveBeenCalledWith('leave_household',undefined);fireEvent.click(screen.getByRole('button',{name:'Confirm leave'}));await waitFor(()=>expect(m.rpc).toHaveBeenCalledWith('leave_household',undefined));expect(await screen.findByRole('button',{name:'Create household'})).toBeInTheDocument();});

it('shows members as avatars without requiring a view-members action',async()=>{
 m.rpc.mockImplementation(async method=>method==='my_household'?{data:[{id:'household-1',name:'Family',role:'owner'}]}:method==='household_members'?{data:[{user_id:'one',display_name:'Julius',role:'owner'},{user_id:'two',display_name:'Majka',role:'member'}]}:{data:null,error:null});
 render(<Household/>);
 expect(await screen.findByLabelText('Julius avatar')).toHaveTextContent('J');
 expect(screen.getByLabelText('Majka avatar')).toHaveTextContent('M');
 expect(screen.queryByRole('button',{name:'View members'})).not.toBeInTheDocument();
});
