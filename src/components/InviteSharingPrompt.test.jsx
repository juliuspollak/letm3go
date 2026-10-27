import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import InviteSharingPrompt from './InviteSharingPrompt.jsx';
afterEach(cleanup);
it('keeps live sharing off unless the recipient explicitly chooses it',()=>{
 const enable=vi.fn(),close=vi.fn();
 render(<InviteSharingPrompt kind="household" onEnable={enable} onClose={close}/>);
 expect(enable).not.toHaveBeenCalled();
 expect(screen.getByRole('heading',{name:"You're connected!"})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Not now'}));
 expect(close).toHaveBeenCalledOnce();
 expect(enable).not.toHaveBeenCalled();
});
it('provides one clear live-sharing action for any accepted invitation',()=>{
 const enable=vi.fn();
 render(<InviteSharingPrompt kind="friend" onEnable={enable} onClose={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'Share live location'}));
 expect(enable).toHaveBeenCalledOnce();
});
