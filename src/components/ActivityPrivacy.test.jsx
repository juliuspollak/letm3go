import { render,screen,fireEvent,waitFor,cleanup } from '@testing-library/react';
import { beforeEach,afterEach,it,expect,vi } from 'vitest';
const mocks=vi.hoisted(()=>({request:vi.fn(),publish:vi.fn(),private:vi.fn()}));
vi.mock('../lib/AuthContext.jsx',()=>({useAuth:()=>({preferences:{},savePreferences:vi.fn()})}));
vi.mock('../lib/supabase.js',()=>({supabase:{}}));
vi.mock('../lib/activitySharing.js',()=>({sharingRequest:mocks.request,publishActivity:mocks.publish,makeActivityPrivate:mocks.private}));
vi.mock('./JourneyMap.jsx',()=>({default:()=> <div>Route preview</div>}));
import ActivityPrivacy from './ActivityPrivacy.jsx';
beforeEach(()=>{vi.clearAllMocks();HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};mocks.request.mockResolvedValue({audience:'public'});mocks.private.mockResolvedValue({audience:'private'});});
afterEach(cleanup);
it('connects the privacy icon to live status and actual revocation',async()=>{
 render(<ActivityPrivacy trip={{id:'trip',points:[],photos:[],title:'Drive'}} places={[]}/>);
 fireEvent.click(screen.getByRole('button',{name:'Activity privacy: check status'}));
 await screen.findByText('A public copy of this trip is shared.');
 fireEvent.click(screen.getByRole('radio',{name:/Private.*Only you/}));
 fireEvent.click(screen.getByRole('button',{name:'Make private'}));
 await waitFor(()=>expect(mocks.private).toHaveBeenCalledWith({},'trip'));
 expect(await screen.findByRole('status')).toHaveTextContent('revoked');
 expect(screen.getByRole('button',{name:'Activity privacy: private'})).toBeInTheDocument();
});
it('requires explicit consent before public publication and never publishes when opening the dialog',async()=>{
 render(<ActivityPrivacy trip={{id:'trip',points:[],photos:[],title:'Drive'}} places={[]}/>);
 fireEvent.click(screen.getByRole('button',{name:'Activity privacy: check status'}));
 await screen.findByText('A public copy of this trip is shared.');
 fireEvent.click(screen.getByRole('radio',{name:/Private.*Only you/}));
 fireEvent.click(screen.getByRole('radio',{name:/Public.*Anyone/}));
 expect(screen.queryByRole('button',{name:'Share publicly'})).not.toBeInTheDocument();
 expect(mocks.publish).not.toHaveBeenCalled();
});

it('keeps public review in the same sheet and requires consent for a private trip',async()=>{
 mocks.request.mockResolvedValue({audience:'private'});
 render(<ActivityPrivacy trip={{id:'trip',points:[],photos:[],title:'Drive'}} places={[]}/>);
 fireEvent.click(screen.getByRole('button',{name:'Activity privacy: check status'}));
 await screen.findByText('Only you can see this trip.');
 expect(screen.queryByRole('button',{name:'Make private'})).not.toBeInTheDocument();
 const sheet=screen.getByRole('dialog');
 fireEvent.click(screen.getByRole('radio',{name:/Public.*Anyone/}));
 expect(screen.getByRole('dialog')).toBe(sheet);
 expect(screen.getByRole('button',{name:'Share publicly'})).toBeDisabled();
 fireEvent.click(screen.getByRole('checkbox'));
 expect(screen.getByRole('button',{name:'Share publicly'})).toBeEnabled();
 expect(mocks.publish).not.toHaveBeenCalled();
});
