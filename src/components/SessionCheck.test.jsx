import { render,screen,fireEvent,waitFor,cleanup } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
const m=vi.hoisted(()=>({verify:vi.fn()}));
vi.mock('../lib/userProfile.js',()=>({verifyAccountSession:m.verify}));
vi.mock('../lib/supabase.js',()=>({supabase:{}}));
import SessionCheck from './SessionCheck.jsx';
afterEach(cleanup);
it('shows immediate checking feedback and displays the result directly beside the control',async()=>{
 let finish;m.verify.mockImplementationOnce((_,__,{onProgress})=>new Promise(resolve=>{finish=()=>{onProgress('Apple sign-in verified. Checking your profile…');resolve({provider:'Apple',userID:'11111111-1111-4111-8111-12345678abcd'});};}));
 render(<SessionCheck session={{user:{id:'owner'}}}/>);fireEvent.click(screen.getByRole('button',{name:'Check sign-in'}));
 expect(screen.getByRole('button',{name:'Checking sign-in…'})).toBeDisabled();expect(screen.getByRole('status')).toHaveTextContent('Checking your sign-in');finish();
 expect(await screen.findByText('Apple sign-in and profile verified. Account ending 5678abcd.')).toBeInTheDocument();expect(screen.getByRole('status').parentElement).toBe(screen.getByRole('button',{name:'Check sign-in'}).parentElement);
});
it('shows failed checks locally and allows a retry',async()=>{m.verify.mockRejectedValueOnce(new Error('The sign-in check timed out.'));render(<SessionCheck session={{}}/>);fireEvent.click(screen.getByRole('button',{name:'Check sign-in'}));expect(await screen.findByRole('alert')).toHaveTextContent('timed out');await waitFor(()=>expect(screen.getByRole('button',{name:'Check sign-in'})).toBeEnabled());});
it('allows a fresh check when the last verification was offline',()=>{render(<SessionCheck session={{}} offline/>);expect(screen.getByRole('button',{name:'Check sign-in'})).toBeEnabled();expect(screen.getByText('Your last verification was offline. Reconnect, then check again.')).toBeInTheDocument();});
