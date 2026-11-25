import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('../lib/supabase.js',()=>({supabase:mock}));
import Household from './Household.jsx';
import {memberLocationState} from '../lib/householdLocation.js';

// The Household tiles state each member's sharing status from the same policy
// as the map, and never show green for a position that has not been received.
const members=[{user_id:'julius',display_name:'Julius',role:'owner'},{user_id:'anna',display_name:'Anna',role:'member'},{user_id:'sam',display_name:'Sam',role:'member'},{user_id:'lee',display_name:'Lee',role:'member'},{user_id:'kim',display_name:'Kim',role:'member'},{user_id:'max',display_name:'Max',role:'member'}];
const server='2026-11-04T08:00:00Z';
const rows={
 anna:{sharing_enabled:true,latitude:-33.87,longitude:151.21,accuracy_m:10,location_at:'2026-11-04T07:59:00Z',server_now:server},
 sam:{sharing_enabled:true,latitude:null,longitude:null,location_at:null,server_now:server},
 lee:{sharing_enabled:true,latitude:-33.8,longitude:151.1,location_at:'2026-11-04T06:00:00Z',server_now:server},
 kim:{sharing_enabled:false,server_now:server},
 max:{sharing_enabled:true,latitude:-33.86,longitude:151.2,location_at:'2026-11-04T07:58:00Z',server_now:server}
};
const peopleById=new Map(Object.entries(rows).map(([id,row])=>{const state=memberLocationState(row);return [id,{position:state.position,location:{state:state.state,ageSeconds:state.ageSeconds,home:id==='max',activity:id==='anna'?'Driving':null},driveSeconds:480,walkSeconds:2280}];}));
beforeEach(()=>{mock.rpc.mockImplementation(async name=>({data:name==='my_household'?[{id:'family',name:'Pollak',role:'owner'}]:name==='household_members'?members:null}));});
afterEach(cleanup);
// Household loads membership asynchronously; allow for a busy test runner.
const tile=async name=>(await screen.findByRole('img',{name:`${name} avatar`},{timeout:5000})).closest('.person-tile');

it('shows each member as sharing, waiting, stale, at home or not sharing, and green only for a received recent position',async()=>{
 render(<Household selfId="julius" liveEnabled peopleById={peopleById} selfLocation={{state:'live',ageSeconds:20}} onShowMember={vi.fn()}/>);
 const anna=await tile('Anna');
 // A shared activity is kept as the status of a live member.
 expect(anna).toHaveAccessibleName(/Driving/);
 expect(anna.querySelector('.person-tile-status svg')).toBeInTheDocument();
 expect(anna.querySelector('.person-driving-status')).toHaveTextContent('Driving');
 expect(anna).not.toHaveTextContent('Location updated');
 expect(anna.querySelector('.person-dot--live')).not.toBeNull();
 expect(anna).toHaveAccessibleName(/8 min drive, 38 min walk/);
 const sam=await tile('Sam');
 expect(within(sam).getByText('Waiting for location')).toBeInTheDocument();
 expect(sam.querySelector('.person-dot--live')).toBeNull();
 const lee=await tile('Lee');
 // Stale is "last seen", never "not sharing".
 expect(within(lee).getByText('Last location · 2 h ago')).toBeInTheDocument();
 expect(lee.querySelector('.person-dot--stale')).not.toBeNull();
 expect(within(await tile('Kim')).getByText('Not sharing')).toBeInTheDocument();
 expect(await tile('Max')).toHaveAccessibleName(/at home.*seen 2 min ago/i);
 const you=await tile('Julius');
 expect(within(you).getByText('You')).toBeInTheDocument();
 expect(within(you).getByText('Sharing')).toBeInTheDocument();
 expect(within(you).getByText('Organiser')).toBeInTheDocument();
});
it('shows the car icon for a driving member with a fresh fix',async()=>{
 const people=new Map(peopleById);
 const anna=people.get('anna');
 people.set('anna',{...anna,location:{...anna.location,ageSeconds:5}});
 render(<Household selfId="julius" peopleById={people}/>);
 const bubble=await tile('Anna');
 expect(bubble).toHaveAccessibleName(/Driving/);
 expect(bubble.querySelector('.person-tile-status svg')).toBeInTheDocument();
 expect(bubble.querySelector('.person-driving-status')).toHaveTextContent('Driving');
 expect(bubble).not.toHaveTextContent('Location updated');
});
it('locates a member with a position on the map, and offers nothing for one without',async()=>{
 const show=vi.fn();
 render(<Household selfId="julius" peopleById={peopleById} selfLocation={{state:'off'}} onShowMember={show}/>);
 await tile('Anna');
 fireEvent.click(screen.getByRole('button',{name:/^Show Anna on the map/}));
 expect(show).toHaveBeenCalledWith({latitude:-33.87,longitude:151.21,accuracy:10},'anna');
 expect(screen.queryByRole('button',{name:/^Show Sam on the map/})).toBeNull();
 expect(screen.queryByRole('button',{name:/^Show You on the map/})).toBeNull();
});
it('treats a member missing from the location rows as not sharing',async()=>{
 render(<Household selfId="julius" selfLocation={null}/>);
 expect(within(await tile('Anna')).getByText('Not sharing')).toBeInTheDocument();
});
it('never says you are at home without a current shared position',async()=>{
 render(<Household selfId="julius" liveEnabled selfLocation={{state:'waiting',home:true}}/>);
 const you=await tile('Julius');
 expect(within(you).queryByText('At home')).toBeNull();
 expect(within(you).getByText('Sharing · waiting to send')).toBeInTheDocument();
});
