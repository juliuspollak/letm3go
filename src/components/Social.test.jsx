import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('../lib/supabase.js',()=>({supabase:mock}));
import Friends from './Friends.jsx';
import Household from './Household.jsx';
import LocationSharingRow from './LocationSharingRow.jsx';
import {personStatus,selfStatus} from '../lib/personStatus.js';

const household=(role='owner')=>async name=>({data:name==='my_household'?[{id:'family',name:'WarillaFamily',role}]:name==='household_members'?[{user_id:'me',display_name:'Julius',role}]:name==='invite_to_household'?'HOUSE-CODE':name==='my_household_vehicles'?[{id:'car',display_name:'Family car',local_vehicle_id:null}]:name==='create_friend_invite'?'FRIEND-CODE':name==='my_friends'?[]:null,error:null});
beforeEach(()=>{mock.rpc.mockImplementation(household());});
afterEach(cleanup);

describe('My location',()=>{
 it('keeps friend and household sharing independent',async()=>{
  const friends=vi.fn().mockResolvedValue(),homeShare=vi.fn().mockResolvedValue(),homeStop=vi.fn();
  render(<><Friends sharing={{enabled:false,ready:true,onChange:friends}}/><Household selfId="me" liveEnabled={false} onShareLive={homeShare} onStopLive={homeStop}/></>);
  fireEvent.click(screen.getByRole('switch',{name:'Share my location with friends'}));
  await waitFor(()=>expect(friends).toHaveBeenCalledWith(true));
  expect(homeShare).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('switch',{name:'Share my location with household'}));
  await waitFor(()=>expect(homeShare).toHaveBeenCalledTimes(1));
  expect(friends).toHaveBeenCalledTimes(1);
  expect(homeStop).not.toHaveBeenCalled();
 });
 it('shows the confirmed setting, and a failed change as an error without switching',async()=>{
  const change=vi.fn().mockRejectedValue(new Error('Connect to change location sharing.'));
  const {rerender}=render(<LocationSharingRow audience="household" enabled={false} onChange={change}/>);
  const toggle=screen.getByRole('switch',{name:'Share my location with household'});
  expect(toggle).toHaveAttribute('aria-checked','false');
  expect(screen.getByText('Off')).toBeInTheDocument();
  fireEvent.click(toggle);
  expect(await screen.findByRole('alert')).toHaveTextContent('Connect to change location sharing.');
  expect(toggle).toHaveAttribute('aria-checked','false');
  // Only the caller's confirmed state turns it on.
  rerender(<LocationSharingRow audience="household" enabled onChange={change}/>);
  expect(toggle).toHaveAttribute('aria-checked','true');
  expect(screen.getByText('Shared with household')).toBeInTheDocument();
 });
 it('waits for the server before showing a setting, and shows progress while changing',async()=>{
  let finish;const change=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
  const {rerender}=render(<LocationSharingRow audience="friends" ready={false} enabled={false} onChange={change}/>);
  expect(screen.getByRole('switch')).toBeDisabled();
  expect(screen.getByText('Checking…')).toBeInTheDocument();
  rerender(<LocationSharingRow audience="friends" enabled={false} onChange={change}/>);
  fireEvent.click(screen.getByRole('switch'));
  expect(screen.getByText('Updating…')).toBeInTheDocument();
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked','false');
  await act(async()=>finish());
 });
 it('explains a location permission problem only when sharing is on',()=>{
  const {rerender}=render(<LocationSharingRow audience="friends" enabled={false} permission="denied"/>);
  expect(screen.queryByRole('status')).toBeNull();
  rerender(<LocationSharingRow audience="friends" enabled permission="denied"/>);
  expect(screen.getByRole('status')).toHaveTextContent('Turn on Location');
  expect(screen.getByText('On · location access is off')).toBeInTheDocument();
  expect(selfStatus({enabled:true,state:'live',permission:'denied'})).toEqual({text:'Location access needed',tone:'issue'});
 });
});

describe('statuses',()=>{
 it('never confuses an old position with sharing turned off',()=>{
  expect(personStatus({state:'stale',ageSeconds:7200})).toEqual({text:'Last seen 2 h ago',tone:'stale'});
  expect(personStatus({state:'unknown'})).toEqual({text:'No recent location',tone:'none'});
  expect(personStatus({state:'off'})).toEqual({text:'Not sharing',tone:'off'});
  expect(personStatus({state:'live',ageSeconds:30})).toEqual({text:'Sharing · just now',tone:'live'});
  expect(personStatus({state:'live',ageSeconds:60,activity:'Cycling'}).text).toBe('Cycling · 1 min ago');
 });
 it('says At home only for a live position',()=>{
  expect(personStatus({state:'live',home:true}).text).toBe('At home');
  expect(personStatus({state:'stale',ageSeconds:600,home:true}).text).toBe('Last seen 10 min ago');
  expect(selfStatus({enabled:true,state:'live',home:true}).text).toBe('At home');
  expect(selfStatus({enabled:true,state:'stale',ageSeconds:900,home:true}).text).toBe('Last sent 15 min ago');
  expect(selfStatus({enabled:false,state:'live',home:true}).text).toBe('Not sharing');
 });
 it('shows a friend without a recent position as such, and a sharing friend on the map',async()=>{
  mock.rpc.mockImplementation(async name=>({data:name==='my_friends'?[{user_id:'majka',display_name:'Majka'},{user_id:'julia',display_name:'julia'},{user_id:'ola',display_name:'Ola'}]:null}));
  const show=vi.fn();
  render(<Friends onShowPerson={show} locations={{majka:{state:'live',ageSeconds:60,position:{latitude:1,longitude:2}},julia:{state:'stale',ageSeconds:7200,position:{latitude:3,longitude:4}}}}/>);
  const tile=async name=>(await screen.findByRole('img',{name:`${name} avatar`})).closest('.person-tile');
  expect(within(await tile('Majka')).getByText('Sharing · 1 min ago')).toBeInTheDocument();
  expect(within(await tile('julia')).getByText('Last seen 2 h ago')).toBeInTheDocument();
  expect(within(await tile('Ola')).getByText('No recent location')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:/^Show Majka on the map/}));
  expect(show).toHaveBeenCalledWith({latitude:1,longitude:2},'majka');
  expect(screen.queryByRole('button',{name:/^Show Ola on the map/})).toBeNull();
 });
});

describe('Friends',()=>{
 it('keeps the invitation tools behind Add friend, and they still work',async()=>{
  render(<Friends/>);
  expect(screen.queryByRole('button',{name:/Create invitation/})).toBeNull();
  expect(screen.queryByText(/Friends are separate from household members/)).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Add friend'}));
  const sheet=screen.getByRole('dialog',{name:'Add friend'});
  fireEvent.click(within(sheet).getByRole('button',{name:/Create invitation/}));
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('create_friend_invite',undefined));
  expect(await within(sheet).findByRole('button',{name:/Share invitation/})).toBeInTheDocument();
  expect(within(sheet).getByText('FRIEND-CODE')).toBeInTheDocument();
  fireEvent.click(within(sheet).getByRole('button',{name:'Close'}));
  expect(screen.queryByRole('dialog',{name:'Add friend'})).toBeNull();
 });
 it('accepts an invitation code and then offers, but never enables, location sharing',async()=>{
  const share=vi.fn();
  render(<Friends invitationCode="THEIR-CODE" onShareLive={share}/>);
  const sheet=await screen.findByRole('dialog',{name:'Add friend'});
  await waitFor(()=>expect(within(sheet).getByPlaceholderText('Paste their code')).toHaveValue('THEIR-CODE'));
  fireEvent.click(within(sheet).getByRole('button',{name:'Add friend'}));
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('accept_friend_invite',{p_token:'THEIR-CODE'}));
  expect(await screen.findByRole('dialog',{name:'Choose live location sharing'})).toBeInTheDocument();
  expect(share).not.toHaveBeenCalled();
 });
});

describe('Household',()=>{
 it('leads with the name, my location and the members, then compact actions',async()=>{
  const openMap=vi.fn();
  render(<Household selfId="me" onOpenMap={openMap}/>);
  expect(await screen.findByRole('heading',{name:'WarillaFamily'})).toBeInTheDocument();
  expect(screen.getByRole('switch',{name:'Share my location with household'})).toBeInTheDocument();
  expect(screen.queryByText(/Shared transport/)).toBeNull();
  expect(screen.queryByRole('button',{name:'Leave household'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Family map'}));
  expect(openMap).toHaveBeenCalled();
 });
 it('invites a member only for the organiser, in a sheet',async()=>{
  render(<Household selfId="me"/>);
  fireEvent.click(await screen.findByRole('button',{name:'Invite'}));
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('invite_to_household',undefined));
  const sheet=await screen.findByRole('dialog',{name:'Invite to WarillaFamily'});
  expect(within(sheet).getByRole('button',{name:/Share invitation/})).toBeInTheDocument();
  expect(within(sheet).getByText('HOUSE-CODE')).toBeInTheDocument();
  cleanup();
  mock.rpc.mockImplementation(household('member'));
  render(<Household selfId="me"/>);
  await screen.findByRole('heading',{name:'WarillaFamily'});
  expect(screen.queryByRole('button',{name:'Invite'})).toBeNull();
 });
 it('keeps shared vehicles and membership in Settings',async()=>{
  render(<Household selfId="me"/>);
  fireEvent.click(await screen.findByRole('button',{name:'Settings'}));
  const sheet=screen.getByRole('dialog',{name:'Household settings'});
  fireEvent.click(within(sheet).getByRole('button',{name:'Shared vehicles'}));
  fireEvent.click(within(sheet).getByRole('button',{name:'View household vehicles'}));
  expect(await within(sheet).findByText('Family car')).toBeInTheDocument();
  expect(within(sheet).getByRole('button',{name:'Add household vehicle'})).toBeInTheDocument();
  expect(within(sheet).getAllByText('Organiser').length).toBeGreaterThan(0);
 });
});

describe('sharing setting versus delivery',()=>{
 const you=()=>screen.getByRole('img',{name:'Julius avatar'}).closest('.person-tile');
 const friends=(props)=><Friends selfName="Julius" selfId="me" sharing={{enabled:true,ready:true,onChange:vi.fn()}} {...props}/>;
 it('does not call the setting alone "Sharing": it needs a position friends received',async()=>{
  const {rerender}=render(friends({self:{state:'waiting'}}));
  expect(within(you()).getByText('Sharing · waiting to send')).toBeInTheDocument();
  rerender(friends({self:{state:'live',ageSeconds:20}}));
  expect(within(you()).getByText('Sharing')).toBeInTheDocument();
  rerender(friends({self:{state:'stale',ageSeconds:1500}}));
  expect(within(you()).getByText('Last sent 25 min ago')).toBeInTheDocument();
  rerender(friends({self:{state:'live',ageSeconds:20},sharing:{enabled:false,ready:true,onChange:vi.fn()}}));
  expect(within(you()).getByText('Not sharing')).toBeInTheDocument();
  // The switch itself still shows the confirmed setting.
  expect(screen.getByRole('switch',{name:'Share my location with friends'})).toHaveAttribute('aria-checked','false');
  await screen.findByText(/No friends yet/);
 });
 it('flags denied or imprecise location while sharing is on, and clears it once iOS settings change',async()=>{
  const {rerender}=render(friends({self:{state:'live'},permission:'denied'}));
  expect(within(you()).getByText('Location access needed')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Turn on Location and Precise Location');
  rerender(friends({self:{state:'live'},permission:'always',precise:false}));
  expect(within(you()).getByText('Location access needed')).toBeInTheDocument();
  // Returning from iOS Settings with access restored (the recorder state refreshes on resume).
  rerender(friends({self:{state:'live'},permission:'always',precise:true}));
  expect(screen.queryByRole('status')).toBeNull();
  expect(within(you()).getByText('Sharing')).toBeInTheDocument();
  rerender(friends({self:{state:'live'},permission:'whenInUse',precise:true}));
  expect(screen.getByRole('status')).toHaveTextContent('Set Location to Always');
  await screen.findByText(/No friends yet/);
 });
 it('keeps the household self status on confirmed sends as well',async()=>{
  render(<Household selfId="me" liveEnabled selfLocation={{state:'waiting'}}/>);
  const tile=(await screen.findByRole('img',{name:'Julius avatar'})).closest('.person-tile');
  expect(within(tile).getByText('Sharing · waiting to send')).toBeInTheDocument();
 });
});
