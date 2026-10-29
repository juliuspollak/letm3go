import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('../lib/supabase.js',()=>({supabase:mock}));
import Household from './Household.jsx';
import {locationStatusText,memberLocationState} from '../lib/householdLocation.js';

// The Household bubbles state each member's sharing status from the same policy
// as the map, and never show green for a position that has not been received.
const members=[{user_id:'julius',display_name:'Julius',role:'owner'},{user_id:'anna',display_name:'Anna',role:'member'},{user_id:'sam',display_name:'Sam',role:'member'},{user_id:'lee',display_name:'Lee',role:'member'},{user_id:'kim',display_name:'Kim',role:'member'}];
const server='2026-11-04T08:00:00Z';
const rows={
 anna:{sharing_enabled:true,latitude:-33.87,longitude:151.21,accuracy_m:10,location_at:'2026-11-04T07:59:00Z',server_now:server},
 sam:{sharing_enabled:true,latitude:null,longitude:null,location_at:null,server_now:server},
 lee:{sharing_enabled:true,latitude:-33.8,longitude:151.1,location_at:'2026-11-04T06:00:00Z',server_now:server},
 kim:{sharing_enabled:false,server_now:server}
};
const memberLocations=Object.fromEntries(Object.entries(rows).map(([id,row])=>{const state=memberLocationState(row);return [id,{state:state.state,text:locationStatusText(state),position:state.position}];}));
beforeEach(()=>{mock.rpc.mockImplementation(async name=>({data:name==='my_household'?[{id:'family',name:'Pollak',role:'owner'}]:name==='household_members'?members:null}));});
afterEach(cleanup);
// Household loads membership asynchronously; allow for a busy test runner.
const bubble=async name=>(await screen.findByRole('img',{name:`${name} avatar`},{timeout:5000})).closest('.person-bubble');

it('shows each member as sharing, waiting, stale or off, and green only for a received recent position',async()=>{
 render(<Household selfId="julius" memberLocations={memberLocations} selfLocation={{state:'live',text:'Sharing location · sent just now'}} onShowMember={vi.fn()}/>);
 const anna=await bubble('Anna');
 expect(within(anna).getByText('Sharing location · updated 1 min ago')).toBeInTheDocument();
 expect(anna.querySelector('.person-location-badge--live')).not.toBeNull();
 const sam=await bubble('Sam');
 expect(within(sam).getByText('Waiting for location')).toBeInTheDocument();
 expect(sam.querySelector('.person-location-badge--live')).toBeNull();
 expect(sam.querySelector('.person-location-badge--waiting')).not.toBeNull();
 const lee=await bubble('Lee');
 expect(within(lee).getByText('Last updated 2 h ago')).toBeInTheDocument();
 expect(lee.querySelector('.person-location-badge--stale')).not.toBeNull();
 const kim=await bubble('Kim');
 expect(within(kim).getByText('Location sharing off')).toBeInTheDocument();
 expect(kim.querySelector('.person-location-badge--off')).not.toBeNull();
 expect(within(await bubble('Julius')).getByText('Sharing location · sent just now')).toBeInTheDocument();
});
it('locates a member with a position on the map, and offers nothing for one without',async()=>{
 const show=vi.fn();
 render(<Household selfId="julius" memberLocations={memberLocations} selfLocation={{state:'off',text:'Location sharing off'}} onShowMember={show}/>);
 fireEvent.click(within(await bubble('Anna')).getByRole('button',{name:'Show Anna on the map'}));
 expect(show).toHaveBeenCalledWith({latitude:-33.87,longitude:151.21,accuracy:10},'anna');
 expect(within(await bubble('Sam')).queryByRole('button',{name:/on the map/})).toBeNull();
 expect(within(await bubble('Julius')).queryByRole('button',{name:/on the map/})).toBeNull();
});
it('treats a member missing from the location rows as not sharing',async()=>{
 render(<Household selfId="julius" memberLocations={{}} selfLocation={null}/>);
 expect(within(await bubble('Anna')).getByText('Location sharing off')).toBeInTheDocument();
});
