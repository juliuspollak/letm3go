import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import PeopleGrid,{PeopleSkeleton} from './PeopleGrid.jsx';

afterEach(cleanup);
const person=over=>({id:'p',userId:'p',name:'Julia',status:{text:'At school',tone:'live'},...over});

it('tapping a person shows them on the Map and never pokes', ()=>{
 const open=vi.fn(),poke=vi.fn();
 render(<PeopleGrid people={[person({onSelect:open,onPoke:poke,actionLabel:'Show Julia on the Map.'})]} label="People"/>);
 fireEvent.click(screen.getByLabelText(/Show Julia on the Map/));
 expect(open).toHaveBeenCalledTimes(1);expect(poke).not.toHaveBeenCalled();
});
it('Poke is its own button under the status: it pokes once and never opens the Map', ()=>{
 const open=vi.fn(),poke=vi.fn();
 const {container}=render(<PeopleGrid people={[person({onSelect:open,onPoke:poke,actionLabel:'Show Julia on the Map.'})]} label="People"/>);
 const button=screen.getByRole('button',{name:'Poke Julia'});
 expect(button.textContent).toBe('👋 Poke');
 expect(button.closest('button.is-button')).toBeNull(); // not inside the tile's button
 fireEvent.click(button);
 expect(poke).toHaveBeenCalledTimes(1);expect(open).not.toHaveBeenCalled();
 // Order: avatar, name, status, then Poke.
 const wrap=container.querySelector('.person-tile-wrap');
 expect(wrap.lastElementChild).toBe(button);
});
it('shows the compact status line, and keeps the full wording for the screen reader', ()=>{
 render(<PeopleGrid people={[person({short:'2.6 km · 8m ago',status:{text:'Sharing · 8 min ago · 2.6 km away',tone:'live'},onSelect:vi.fn()})]} label="People"/>);
 expect(screen.getByText('2.6 km · 8m ago')).toBeTruthy();
 expect(screen.queryByText(/Sharing · 8 min/)).toBeNull();
 expect(screen.getByRole('button',{name:/Sharing · 8 min ago · 2.6 km away/})).toBeTruthy();
});
it('Poke: sending is disabled so it cannot double-send, then confirms, and a failure offers a retry', ()=>{
 const poke=vi.fn();
 const view=state=>render(<PeopleGrid people={[person({onSelect:vi.fn(),onPoke:poke,poke:state})]} label="People"/>);
 const sending=view({state:'sending'});
 const busy=screen.getByRole('button',{name:'Poking Julia'});
 expect(busy.disabled).toBe(true);expect(busy.textContent).toBe('Poking…');
 fireEvent.click(busy);expect(poke).not.toHaveBeenCalled();
 sending.unmount();
 const sent=view({state:'sent'});
 const done=screen.getByRole('button',{name:'Poked Julia'});expect(done.textContent).toBe('✓ Poked');
 fireEvent.click(done);expect(poke).not.toHaveBeenCalled(); // not again while it shows Poked
 sent.unmount();
 view({state:'failed',message:'Slow down'});
 const retry=screen.getByRole('button',{name:/Poke Julia failed: Slow down/});
 expect(retry.textContent).toBe('Retry poke');
 expect(screen.getByText('Slow down')).toBeTruthy(); // the reason is visible, not only spoken
 fireEvent.click(retry);expect(poke).toHaveBeenCalledTimes(1);
});
it('has no ••• menu, hold gesture, bubble or wiggle', ()=>{
 const {container}=render(<PeopleGrid people={[person({onSelect:vi.fn(),onPoke:vi.fn()})]} label="People"/>);
 expect(screen.queryByLabelText(/More actions/)).toBeNull();
 expect(container.querySelector('.poke-bubble,.person-more,.person-tile--poked')).toBeNull();
});
it('shows an incoming poke as a short line in the status place', ()=>{
 render(<PeopleGrid people={[person({short:'2.6 km · 8m ago',onSelect:vi.fn(),poke:{state:'received'}})]} label="People"/>);
 expect(screen.getByText('Poked you 👋')).toBeTruthy();
});
it('shows no poke control where poking is not offered',()=>{
 render(<PeopleGrid people={[person({onSelect:vi.fn()})]} label="People"/>);
 expect(screen.queryByRole('button',{name:/^Poke/})).toBeNull();
});
it('identifies home with the same location text and status icon',()=>{
 const {container}=render(<PeopleGrid people={[person({location:{state:'stale',verifiedHome:true,ageSeconds:900}})]} label="People"/>);
 expect(screen.getByRole('group',{name:/last verified at home.*seen 15 min ago/i})).toBeInTheDocument();
 expect(screen.queryByText('Seen 15 min ago')).toBeNull();
 expect(container.querySelector('.person-dot--stale')).not.toBeNull();
});
it('shows a loading placeholder, not a list or an empty claim', ()=>{
 render(<PeopleSkeleton/>);
 const list=screen.getByRole('status',{name:'Loading friends'});
 expect(list.getAttribute('aria-busy')).toBe('true');
 expect(list.querySelectorAll('li')).toHaveLength(3);
});

it('alternates drive and walk in a single label above the Home avatar and labels an old location',()=>{
 const {container}=render(<PeopleGrid people={[person({
  location:{state:'stale',ageSeconds:18000},short:'2.5 km · 5h ago',
  driveSeconds:480,walkSeconds:2280,cycleSeconds:720,onSelect:vi.fn()
 })]} label="Friends and household"/>);
 const avatar=container.querySelector('.person-tile');
 expect(avatar.querySelector('.person-travel')).toHaveClass('person-travel--alternating');
 expect(avatar.querySelector('.person-travel-drive')).toHaveTextContent('8 min drive');
 expect(avatar.querySelector('.person-travel-walk')).toHaveTextContent('38 min walk');
 expect(avatar.querySelector('.person-travel-cycle')).toHaveTextContent('12 min cycle');
 expect(avatar.querySelector('.person-travel-snail')).toHaveTextContent(/^26 days$/);
 expect(avatar.querySelector('.person-travel')).toHaveAttribute('data-count','4');
 expect(screen.getByText('Last location · 5 h ago')).toBeInTheDocument();
 expect(screen.queryByText('2.5 km · 5h ago')).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:/to last known location.*8 min drive, 38 min walk, 12 min cycle, 26 days snail/i})).toBeInTheDocument();
});

it('shows confirmed time at Home with a house and hides both travel estimates',()=>{
 const {container}=render(<PeopleGrid people={[person({
  location:{state:'live',home:true,ageSeconds:90,homeSeconds:4500},
  driveSeconds:480,walkSeconds:2280,cycleSeconds:720,onSelect:vi.fn()
 })]} label="People"/>);
 expect(screen.getByRole('button',{name:/at home.*since 1h 15 min ago/i})).toBeInTheDocument();
 expect(screen.queryByText('Since 1h 15 min ago')).toBeNull();
 expect(container.querySelector('.person-tile-heading svg')).not.toBeNull();
 expect(container.querySelector('.person-travel')).toBeNull();
});

it('restores the avatar after two seconds and keeps the refresh result',()=>{
 vi.useFakeTimers();
 try{
  const {container}=render(<PeopleGrid people={[person({refreshLabel:'No new location'})]} label="People"/>);
  expect(container.querySelector('.person-refresh-clock')).toBeInTheDocument();
  act(()=>vi.advanceTimersByTime(2000));
  expect(container.querySelector('.person-refresh-clock')).toBeNull();
  expect(screen.getByRole('img',{name:'Julia avatar'})).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('No new location');
 }finally{
  vi.useRealTimers();
 }
});

it('keeps the car and one status line as a driving observation ages',()=>{
 const driver=person({location:{state:'live',ageSeconds:90,activity:'Driving'}});
 const {container,rerender}=render(<PeopleGrid people={[driver]} label="People"/>);
 const status=()=>container.querySelector('.person-driving-status');
 expect(status()).toHaveTextContent(/^Driving$/);
 expect(status().querySelector('svg')).toBeInTheDocument();
 rerender(<PeopleGrid people={[{...driver,location:{state:'live',ageSeconds:121,lastKnownActivity:'Driving'}}]} label="People"/>);
 expect(status()).toHaveTextContent(/^Last seen driving$/);
 expect(status().querySelector('svg')).toBeInTheDocument();
 expect(container).not.toHaveTextContent('Location updated');
 rerender(<PeopleGrid people={[{...driver,location:{state:'live',ageSeconds:5,activity:null}}]} label="People"/>);
 expect(status()).toBeNull();
});
