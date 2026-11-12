import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import HistorySharingRow from './HistorySharingRow.jsx';

afterEach(cleanup);
function client({enabled=false,waiting=0,needsHome=false,rounds=[{published:2,failed:0,remaining:0}]}={}){
 const state={enabled,waiting};
 return {
  rpc:vi.fn(async(name,args)=>{
   if(name==='my_history_sharing')return {data:{enabled:state.enabled,waiting:state.waiting,needsHome,published:0},error:null};
   if(name==='set_history_sharing'){state.enabled=args.p_enabled;return {data:null,error:null};}
   return {data:null,error:null};
  }),
  functions:{invoke:vi.fn(async()=>({data:rounds.shift()??{published:0,failed:0,remaining:0},error:null}))},
 };
}
it('is hidden until the database knows about it',async()=>{
 const {container}=render(<HistorySharingRow client={{rpc:async()=>({data:null,error:{code:'PGRST202'}})}}/>);
 await new Promise(r=>setTimeout(r,10));
 expect(container.textContent).toBe('');
});
it('does not share anything until the owner agrees; asking first, with Home and Work stated',async()=>{
 const c=client();
 render(<HistorySharingRow client={c}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Share earlier activities'}));
 expect(screen.getByText(/Home and Work are hidden/)).toBeTruthy();
 expect(c.rpc).not.toHaveBeenCalledWith('set_history_sharing',expect.anything());
 expect(c.functions.invoke).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Cancel'}));
 expect(c.functions.invoke).not.toHaveBeenCalled();
});
it('agreeing records the consent and then shares them, reporting the result',async()=>{
 const c=client({rounds:[{published:3,failed:0,remaining:0}]});
 render(<HistorySharingRow client={c}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Share earlier activities'}));
 fireEvent.click(screen.getByRole('button',{name:'Share them'}));
 await waitFor(()=>expect(screen.getByText('Shared 3 earlier activities.')).toBeTruthy());
 expect(c.rpc).toHaveBeenCalledWith('set_history_sharing',{p_enabled:true});
 expect(c.functions.invoke).toHaveBeenCalledTimes(1);
});
it('asks for a Home place first when there is none, and says nothing was shared',async()=>{
 const c=client({rounds:[{published:0,failed:0,remaining:97,needsHome:true}]});
 render(<HistorySharingRow client={c}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Share earlier activities'}));
 fireEvent.click(screen.getByRole('button',{name:'Share them'}));
 await waitFor(()=>expect(screen.getByText(/Save your Home place first/)).toBeTruthy());
});
it('once agreed it offers Share now for what waits, and Stop sharing, which takes them back',async()=>{
 const c=client({enabled:true,waiting:4,rounds:[{published:4,failed:0,remaining:0}]});
 render(<HistorySharingRow client={c}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Share now'}));
 await waitFor(()=>expect(screen.getByText('Shared 4 earlier activities.')).toBeTruthy());
 fireEvent.click(screen.getByRole('button',{name:'Stop sharing'}));
 await waitFor(()=>expect(c.rpc).toHaveBeenCalledWith('set_history_sharing',{p_enabled:false}));
 await waitFor(()=>expect(screen.getByText('Earlier activities are no longer shared.')).toBeTruthy());
});
it('keeps the way to stop when household sharing was switched off after agreeing, and hides the offer otherwise',async()=>{
 const c=client({enabled:true,waiting:2});
 const {container,rerender}=render(<HistorySharingRow client={c} autoEnabled={false}/>);
 expect(await screen.findByRole('button',{name:'Stop sharing'})).toBeTruthy();
 expect(screen.getByText(/Paused while sharing new activities is off/)).toBeTruthy();
 cleanup();
 const off=render(<HistorySharingRow client={client()} autoEnabled={false}/>);
 await new Promise(r=>setTimeout(r,10));
 expect(off.container.textContent).toBe('');
 void container;void rerender;
});

