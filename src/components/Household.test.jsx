import { render,screen,cleanup,fireEvent,waitFor } from '@testing-library/react';
import { afterEach,it,expect,vi } from 'vitest';
const m=vi.hoisted(()=>({rpc:vi.fn()}));vi.mock('../lib/supabase.js',()=>({supabase:m}));
import Household from './Household.jsx';
import Friends from './Friends.jsx';
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

it('opens the confirmation for a modern household code without attempting legacy acceptance',async()=>{
 const code='11111111-2222-4333-8444-555555555555',preview={household_name:'Family',can_join:true};
 const onReviewInvitation=vi.fn();
 m.rpc.mockClear();
 m.rpc.mockImplementation(async method=>method==='my_household'?{data:[]}:{data:[preview]});
 render(<Household onReviewInvitation={onReviewInvitation}/>);
 fireEvent.change(await screen.findByRole('textbox',{name:'Have an invitation code?'}),{target:{value:code}});
 fireEvent.click(screen.getByRole('button',{name:'Join household'}));
 await waitFor(()=>expect(onReviewInvitation).toHaveBeenCalledWith(code,preview));
 expect(m.rpc).toHaveBeenCalledWith('friend_invite_preview',{p_token:code});
 expect(m.rpc).not.toHaveBeenCalledWith('accept_household_invitation',{p_token:code});
 expect(m.rpc).not.toHaveBeenCalledWith('accept_friend_invite',{p_token:code});
});

it('requires Join before accepting a preview handed off from Household',async()=>{
 const code='11111111-2222-4333-8444-555555555555';
 const onHouseholdJoined=vi.fn();
 m.rpc.mockClear();
 m.rpc.mockResolvedValue({data:[],error:null});
 render(<Friends invitationCode={code} invitationPreview={{invited_by_name:'Alex',household_name:'Family',can_join:true}} onHouseholdJoined={onHouseholdJoined}/>);
 expect(await screen.findByText('Alex invited you to Family')).toBeInTheDocument();
 expect(m.rpc).not.toHaveBeenCalledWith('accept_friend_invite',{p_token:code});
 fireEvent.click(screen.getByRole('button',{name:'Join',exact:true}));
 await waitFor(()=>expect(onHouseholdJoined).toHaveBeenCalledOnce());
 expect(m.rpc).toHaveBeenCalledWith('accept_friend_invite',{p_token:code});
});

it('does not accept a Friends code when the household preview request fails',async()=>{
 const code='11111111-2222-4333-8444-555555555555';
 m.rpc.mockClear();
 m.rpc.mockImplementation(async method=>method==='friend_invite_preview'
  ?{error:{message:'Invitation could not be checked'}}:{data:[]});
 render(<Friends invitationCode={code}/>);
 expect(await screen.findByDisplayValue(code)).toBeInTheDocument();
 fireEvent.submit(screen.getByRole('textbox',{name:'Have an invitation code?'}).closest('form'));
 expect(await screen.findByRole('alert')).toHaveTextContent('Invitation could not be checked');
 expect(m.rpc).not.toHaveBeenCalledWith('accept_friend_invite',{p_token:code});
});
