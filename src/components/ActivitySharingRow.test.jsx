import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import ActivitySharingRow from './ActivitySharingRow.jsx';
import {socialCache} from '../lib/socialCache.js';
afterEach(()=>{cleanup();socialCache.clear();});
const client=(state,set=vi.fn(async()=>({error:null})),waiting=[])=>({rpc:vi.fn(async name=>name==='my_auto_share'?{data:state,error:null}:name==='my_auto_share_pending'?{data:waiting,error:null}:set())});

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

it('says how many activities are waiting to be sent, instead of failing silently',async()=>{
 render(<ActivitySharingRow client={client({enabled:true},undefined,[{activity_id:'a'},{activity_id:'b'}])}/>);
 await screen.findByText(/2 waiting to send/);
});

it('holds the row\'s place with a Checking row while it first loads, so nothing below it jumps',async()=>{
 let release;const slow={rpc:vi.fn(name=>name==='my_auto_share'?new Promise(resolve=>{release=()=>resolve({data:{enabled:true},error:null});}):Promise.resolve({data:[],error:null}))};
 const {container}=render(<ActivitySharingRow client={slow} cacheKey="me"/>);
 expect(container.textContent).toContain('New activities');
 expect(container.textContent).toContain('Checking…');
 expect(screen.queryByRole('switch',{name:/Share new activities/})).toBeNull();   // the placeholder is hidden from assistive technology
 await waitFor(()=>expect(release).toBeTypeOf('function'));
 release();
 expect(await screen.findByRole('switch',{name:/Share new activities/})).toBeTruthy();
 expect(container.textContent).not.toContain('Checking…');
});
it('shows the last answer at once on a repeat visit and refreshes it quietly',async()=>{
 const first=render(<ActivitySharingRow client={client({enabled:true})} cacheKey="me"/>);
 await screen.findByRole('switch',{name:/Share new activities/});
 first.unmount();
 const slow={rpc:vi.fn(name=>name==='my_auto_share'?new Promise(()=>{}):Promise.resolve({data:[],error:null}))};   // the refresh never answers: the cached row must not wait for it
 render(<ActivitySharingRow client={slow} cacheKey="me"/>);
 expect(screen.getByRole('switch',{name:/Share new activities/})).toBeTruthy();   // no wait, no placeholder
 expect(screen.queryByText('Checking…')).toBeNull();
});
it('removes the placeholder again when the person is not in a household or the request fails',async()=>{
 const {container}=render(<ActivitySharingRow client={client(null)} cacheKey="me"/>);
 await waitFor(()=>expect(container.textContent).toBe(''));
 cleanup();
 const broken={rpc:vi.fn(async()=>{throw new Error('offline');})};
 const again=render(<ActivitySharingRow client={broken} cacheKey="other"/>);
 await waitFor(()=>expect(again.container.textContent).toBe(''));
});

