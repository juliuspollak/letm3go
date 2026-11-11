import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import LiveDrivePrivacy from './LiveDrivePrivacy.jsx';
afterEach(cleanup);
beforeEach(()=>{try{localStorage.clear();}catch{/* none */}});
const trip={id:'ABCD-1'};

it('tells the phone first, then the server, and then shows the activity as private',async()=>{
 const order=[];
 const deps={recorder:{hideLiveTrail:vi.fn(async()=>{order.push('phone');})},client:{rpc:vi.fn(async()=>{order.push('server');return {error:null};})}};
 render(<LiveDrivePrivacy trip={trip} deps={deps}/>);
 fireEvent.click(screen.getByText(/Keep this activity private/));
 await screen.findByText(/Private: nobody can see/);
 expect(order).toEqual(['phone','server']);
 expect(deps.recorder.hideLiveTrail).toHaveBeenCalledWith('ABCD-1');
 expect(deps.client.rpc).toHaveBeenCalledWith('end_live_trail',{p_ref:'ABCD-1',p_hide:true});
});
it('still succeeds offline: the phone holds the decision and retries the server itself',async()=>{
 const deps={recorder:{hideLiveTrail:vi.fn().mockResolvedValue()},client:{rpc:vi.fn().mockRejectedValue(new Error('offline'))}};
 render(<LiveDrivePrivacy trip={trip} deps={deps}/>);
 fireEvent.click(screen.getByText(/Keep this activity private/));
 await screen.findByText(/Private: nobody can see/);
});
it('does not claim privacy when the phone could not be told, and remembers it afterwards',async()=>{
 const deps={recorder:{hideLiveTrail:vi.fn().mockRejectedValue(new Error('x'))},client:null};
 render(<LiveDrivePrivacy trip={trip} deps={deps}/>);
 fireEvent.click(screen.getByText(/Keep this activity private/));
 await screen.findByRole('alert');
 expect(screen.queryByText(/Private: nobody/)).toBeNull();
 cleanup();
 const ok={recorder:{hideLiveTrail:vi.fn().mockResolvedValue()},client:null};
 render(<LiveDrivePrivacy trip={trip} deps={ok}/>);
 fireEvent.click(screen.getByText(/Keep this activity private/));
 await waitFor(()=>expect(screen.getByText(/Private: nobody/)).toBeTruthy());
 cleanup();
 render(<LiveDrivePrivacy trip={trip} deps={ok}/>);   // a reopened screen still shows it private
 expect(screen.getByText(/Private: nobody/)).toBeTruthy();
});
