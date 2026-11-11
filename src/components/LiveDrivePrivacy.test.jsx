import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import LiveDrivePrivacy,{RETRY_MS} from './LiveDrivePrivacy.jsx';
afterEach(()=>{cleanup();vi.useRealTimers();});
beforeEach(()=>{try{localStorage.clear();}catch{/* none */}});
const trip={id:'ABCD-1'};
const ok={data:null,error:null},bad={data:null,error:{message:'offline'}};

it('tells the phone first, then the server, and says private only once the server confirmed',async()=>{
 const order=[];
 const deps={recorder:{hideLiveTrail:vi.fn(async()=>{order.push('phone');})},client:{rpc:vi.fn(async()=>{order.push('server');return ok;})}};
 render(<LiveDrivePrivacy trip={trip} deps={deps}/>);
 fireEvent.click(screen.getByText(/Keep this activity private/));
 await screen.findByText(/Private: nobody can see/);
 expect(order).toEqual(['phone','server']);
 expect(deps.client.rpc).toHaveBeenCalledWith('end_live_trail',{p_ref:'ABCD-1',p_hide:true});
});
it('offline: says it stopped on this phone and is waiting, never that remote viewers lost access',async()=>{
 const deps={recorder:{hideLiveTrail:vi.fn().mockResolvedValue()},client:{rpc:vi.fn().mockResolvedValue(bad)}};
 render(<LiveDrivePrivacy trip={trip} deps={deps}/>);
 fireEvent.click(screen.getByText(/Keep this activity private/));
 await screen.findByText(/Stopped sharing from this phone/);
 expect(screen.getByText(/anyone watching may still see the route already sent/)).toBeTruthy();
 expect(screen.queryByText(/Private: nobody can see/)).toBeNull();
});
it('keeps retrying and moves to confirmed when the server finally answers',async()=>{
 vi.useFakeTimers({shouldAdvanceTime:true});
 const deps={recorder:{hideLiveTrail:vi.fn().mockResolvedValue()},client:{rpc:vi.fn().mockResolvedValue(bad)}};
 render(<LiveDrivePrivacy trip={trip} deps={deps}/>);
 fireEvent.click(screen.getByText(/Keep this activity private/));
 await screen.findByText(/Stopped sharing from this phone/);
 await act(async()=>{await vi.advanceTimersByTimeAsync(RETRY_MS+100);});
 expect(screen.getByText(/Stopped sharing from this phone/)).toBeTruthy();      // still offline
 deps.client.rpc.mockResolvedValue(ok);
 await act(async()=>{await vi.advanceTimersByTimeAsync(RETRY_MS+100);});
 await waitFor(()=>expect(screen.getByText(/Private: nobody can see/)).toBeTruthy());
});
it('does not claim privacy when the phone could not be told, and shows the right state again when reopened',async()=>{
 const deps={recorder:{hideLiveTrail:vi.fn().mockRejectedValue(new Error('x'))},client:null};
 render(<LiveDrivePrivacy trip={trip} deps={deps}/>);
 fireEvent.click(screen.getByText(/Keep this activity private/));
 await screen.findByRole('alert');
 expect(screen.queryByText(/Private: nobody/)).toBeNull();
 cleanup();
 const offline={recorder:{hideLiveTrail:vi.fn().mockResolvedValue()},client:{rpc:vi.fn().mockResolvedValue(bad)}};
 render(<LiveDrivePrivacy trip={trip} deps={offline}/>);
 fireEvent.click(screen.getByText(/Keep this activity private/));
 await screen.findByText(/Stopped sharing from this phone/);
 cleanup();
 render(<LiveDrivePrivacy trip={trip} deps={offline}/>);                         // a reopened screen still shows pending
 expect(screen.getByText(/Stopped sharing from this phone/)).toBeTruthy();
});
