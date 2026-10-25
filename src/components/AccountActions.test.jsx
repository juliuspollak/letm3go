import { render,screen,fireEvent,cleanup,waitFor,within } from '@testing-library/react';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
const m=vi.hoisted(()=>({auth:{status:'authenticated',signOut:vi.fn(),deleteAccount:vi.fn()}}));
vi.mock('../lib/AuthContext.jsx',()=>({useAuth:()=>m.auth}));
import AccountActions from './AccountActions.jsx';
beforeEach(()=>{m.auth.signOut.mockReset();m.auth.deleteAccount.mockReset();});
afterEach(cleanup);
it('opens a portal popup immediately without scrolling and restores focus on cancel',()=>{
 render(<AccountActions/>);const trigger=screen.getByRole('button',{name:'Sign out',exact:true});trigger.focus();fireEvent.click(trigger);
 const panel=screen.getByRole('alertdialog',{name:'Sign out?'});expect(panel.parentElement.parentElement).toBe(document.body);expect(within(panel).getByRole('button',{name:'Cancel'})).toHaveFocus();expect(m.auth.signOut).not.toHaveBeenCalled();fireEvent.click(within(panel).getByRole('button',{name:'Cancel'}));expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();expect(trigger).toHaveFocus();
});
it('requires popup confirmation and immediately shows sign-out progress',async()=>{
 let finish;m.auth.signOut.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));render(<AccountActions/>);fireEvent.click(screen.getByRole('button',{name:'Sign out',exact:true}));fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button',{name:'Sign out',exact:true}));expect(m.auth.signOut).toHaveBeenCalledOnce();expect(screen.getByRole('status')).toHaveTextContent('Stopping tracking');expect(screen.getByRole('button',{name:'Signing out…'})).toBeDisabled();finish();await waitFor(()=>expect(screen.queryByText('Signing out…')).not.toBeInTheDocument());
});
it('keeps a failed sign-out visible inside the popup',async()=>{
 m.auth.signOut.mockRejectedValue(new Error('Free device storage before signing out.'));render(<AccountActions/>);fireEvent.click(screen.getByRole('button',{name:'Sign out',exact:true}));fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button',{name:'Sign out',exact:true}));expect(await within(screen.getByRole('alertdialog')).findByRole('alert')).toHaveTextContent('Free device storage');
});
it('requires typed confirmation for deletion without calling the backend on open',()=>{
 render(<AccountActions/>);fireEvent.click(screen.getByRole('button',{name:'Delete account',exact:true}));const panel=screen.getByRole('alertdialog',{name:'Delete your account?'});expect(within(panel).getByLabelText('Type DELETE to confirm')).toHaveAttribute('pattern','DELETE');expect(m.auth.deleteAccount).not.toHaveBeenCalled();
});
it('traps keyboard focus in the popup and handles Escape without closing the parent sheet',()=>{
 const outerKey=vi.fn();document.addEventListener('keydown',outerKey);
 try{render(<AccountActions/>);fireEvent.click(screen.getByRole('button',{name:'Sign out',exact:true}));const dialog=screen.getByRole('alertdialog');const cancel=within(dialog).getByRole('button',{name:'Cancel'}),confirm=within(dialog).getByRole('button',{name:'Sign out'});fireEvent.keyDown(cancel,{key:'Tab',shiftKey:true});expect(confirm).toHaveFocus();fireEvent.keyDown(confirm,{key:'Tab'});expect(cancel).toHaveFocus();fireEvent.keyDown(cancel,{key:'Escape'});expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();expect(outerKey).not.toHaveBeenCalled();}finally{document.removeEventListener('keydown',outerKey);}
});
it('blocks background interaction and preserves the enclosing sheet scroll lock on close',()=>{
 const host=document.createElement('div');host.id='root';document.body.append(host);const previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';
 try{render(<AccountActions/>,{container:host});fireEvent.click(screen.getByRole('button',{name:'Sign out',exact:true}));expect(host).toHaveAttribute('inert');fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button',{name:'Cancel'}));expect(host).not.toHaveAttribute('inert');expect(document.body.style.overflow).toBe('hidden');}finally{cleanup();document.body.style.overflow=previousOverflow;}
});
