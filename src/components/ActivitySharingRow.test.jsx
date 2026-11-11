import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import ActivitySharingRow from './ActivitySharingRow.jsx';
afterEach(cleanup);
const client=(state,set=vi.fn(async()=>({error:null})))=>({rpc:vi.fn(async name=>name==='my_auto_share'?{data:state,error:null}:set())});

it('is hidden for someone who is not in a household',async()=>{
 const {container}=render(<ActivitySharingRow client={client(null)}/>);
 await waitFor(()=>expect(container.textContent).toBe(''));
});
it('shows sharing on by default and turns it off, then back on',async()=>{
 const c=client({enabled:true,since:'x'});
 render(<ActivitySharingRow client={c}/>);
 const toggle=await screen.findByRole('switch',{name:/Share new activities/});
 expect(toggle.getAttribute('aria-checked')).toBe('true');
 fireEvent.click(toggle);
 await waitFor(()=>expect(c.rpc).toHaveBeenCalledWith('set_auto_share',{p_enabled:false}));
 await waitFor(()=>expect(screen.getByText(/Not shared unless you choose/)).toBeTruthy());
 fireEvent.click(screen.getByRole('switch',{name:/Share new activities/}));
 await waitFor(()=>expect(c.rpc).toHaveBeenCalledWith('set_auto_share',{p_enabled:true}));
});
it('keeps the old setting and says so when the change fails',async()=>{
 const c=client({enabled:true},vi.fn(async()=>({error:{message:'x'}})));
 render(<ActivitySharingRow client={c}/>);
 fireEvent.click(await screen.findByRole('switch'));
 await screen.findByRole('alert');
 expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
});
