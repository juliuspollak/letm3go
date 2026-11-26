import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Places from './Places.jsx';
vi.mock('../lib/recorder.js',()=>({recorderAvailable:()=>true}));
vi.mock('./PlacePicker.jsx',()=>({default:({onPick,radius,arrivalRadius})=><button data-radius={radius} data-arrival={arrivalRadius??''} onClick={()=>onPick({latitude:1,longitude:2})}>Choose map point</button>}));
afterEach(cleanup);
it('selects the current position directly and allows saving a private place',async()=>{
 const run=vi.fn().mockResolvedValue({latitude:1,longitude:2,accuracy:10});render(<Places places={[]} run={run}/>);
 fireEvent.click(screen.getByRole('button',{name:'Add a private place'}));
 fireEvent.change(screen.getByLabelText('Place name'),{target:{value:'Home'}});
 expect(screen.getByRole('button',{name:'Save private place'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Use current location'}));
 await screen.findByText('Current position selected. Check the pin and radius before saving.');
 fireEvent.click(screen.getByRole('button',{name:'Save private place'}));
 await waitFor(()=>expect(run).toHaveBeenCalledWith('savePlace',expect.objectContaining({name:'Home',latitude:1,longitude:2,radius:150})));
});
it('keeps a place private unless the owner switches on showing its name to friends',async()=>{
 const run=vi.fn().mockResolvedValue({});render(<Places places={[]} run={run}/>);
 fireEvent.click(screen.getByRole('button',{name:'Add a private place'}));
 fireEvent.change(screen.getByLabelText('Place name'),{target:{value:'School'}});
 fireEvent.click(screen.getByRole('button',{name:'Choose map point'}));
 const toggle=screen.getByLabelText(/Show friends when I'm here/);
 expect(toggle).not.toBeChecked();
 fireEvent.click(screen.getByRole('button',{name:'Save private place'}));
 await waitFor(()=>expect(run).toHaveBeenLastCalledWith('savePlace',expect.objectContaining({name:'School',shareWithFriends:false})));
 fireEvent.click(screen.getByRole('button',{name:'Add a private place'}));
 fireEvent.change(screen.getByLabelText('Place name'),{target:{value:'School'}});
 fireEvent.click(screen.getByRole('button',{name:'Choose map point'}));
 fireEvent.click(screen.getByLabelText(/Show friends when I'm here/));
 fireEvent.click(screen.getByRole('button',{name:'Save private place'}));
 await waitFor(()=>expect(run).toHaveBeenLastCalledWith('savePlace',expect.objectContaining({shareWithFriends:true})));
});
it('sets Home recognition independently from the saved arrival radius',async()=>{
 const run=vi.fn().mockResolvedValue({});
 render(<Places places={[{id:'home',name:'Home',kind:'home',latitude:1,longitude:2,radius:250}]} run={run}/>);
 fireEvent.click(screen.getByRole('button',{name:'Edit Home'}));
 const homeRadius=screen.getByRole('slider',{name:/^Recognition radius/});
 expect(homeRadius).toHaveValue('30');
 expect(homeRadius).toHaveAttribute('min','15');
 expect(homeRadius).toHaveAttribute('max','100');
 const arrival=screen.getByRole('slider',{name:/Arrival and place-name radius/});
 expect(arrival).toHaveAttribute('max','100');
 expect(arrival).toHaveValue('100');
 fireEvent.change(homeRadius,{target:{value:'80'}});
 fireEvent.click(screen.getByRole('button',{name:'Save private place'}));
 await waitFor(()=>expect(run).toHaveBeenCalledWith('savePlace',expect.objectContaining({id:'home',radius:100,homeRecognitionRadius:80})));
});
it('keeps the radius sliders to a range a house or a gym can actually be set in',()=>{
 render(<Places places={[]} run={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'Add a private place'}));
 const radius=screen.getByRole('slider',{name:/Recognition radius/});
 expect(radius).toHaveAttribute('min','50');
 expect(radius).toHaveAttribute('max','500');
 expect(radius).toHaveAttribute('step','5');
 expect(radius).toHaveValue('150');
});
it('lets an older place that is bigger than that keep its own size',()=>{
 render(<Places places={[{id:'park',name:'Big park',kind:'favourite',latitude:1,longitude:2,radius:1200}]} run={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'Edit Big park'}));
 const radius=screen.getByRole('slider',{name:/Recognition radius/});
 expect(radius).toHaveAttribute('max','1200');
 expect(radius).toHaveValue('1200');
 // The range is that place's own: a new place afterwards starts from the normal one again.
 fireEvent.click(screen.getByRole('button',{name:'Cancel'}));
 fireEvent.click(screen.getByRole('button',{name:'Add a private place'}));
 expect(screen.getByRole('slider',{name:/Recognition radius/})).toHaveAttribute('max','500');
});
it('shows both of a Home\'s circles on the map and moves them with the sliders',()=>{
 render(<Places places={[{id:'home',name:'Home',kind:'home',latitude:1,longitude:2,radius:100,homeRecognitionRadius:150}]} run={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'Edit Home'}));
 const map=screen.getByRole('button',{name:'Choose map point'});
 // The recognition circle is the one that is solid; the arrival and place-name circle is the second ring.
 expect(map).toHaveAttribute('data-radius','100');
 expect(map).toHaveAttribute('data-arrival','100');
 fireEvent.change(screen.getByRole('slider',{name:/^Recognition radius/}),{target:{value:'60'}});
 fireEvent.change(screen.getByRole('slider',{name:/Arrival and place-name radius/}),{target:{value:'85'}});
 expect(screen.getByRole('button',{name:'Choose map point'})).toHaveAttribute('data-radius','60');
 expect(screen.getByRole('button',{name:'Choose map point'})).toHaveAttribute('data-arrival','85');
});
it('draws only the one circle for a place that is not Home',()=>{
 render(<Places places={[{id:'gym',name:'Gym',kind:'favourite',latitude:1,longitude:2,radius:120}]} run={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'Edit Gym'}));
 expect(screen.getByRole('button',{name:'Choose map point'})).toHaveAttribute('data-radius','120');
 expect(screen.getByRole('button',{name:'Choose map point'})).toHaveAttribute('data-arrival','');
});
it('offers ordinary place types for new private places',()=>{
 render(<Places places={[]} run={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'Add a private place'}));
 expect(screen.getByLabelText('Type')).toHaveValue('favourite');
 expect(screen.queryByRole('option',{name:/Home/})).not.toBeInTheDocument();
});
it('saves a named household location with its radius, icon and friend audience',async()=>{
 const run=vi.fn().mockResolvedValue(true);
 render(<Places household places={[]} run={run} memberPoints={[{user_id:'majka',display_name:'Majka',position:{latitude:3,longitude:4}}]}/>);
 fireEvent.click(screen.getByRole('button',{name:'Add a location'}));
 fireEvent.change(screen.getByLabelText('Start from someone’s live location'),{target:{value:'majka'}});
 fireEvent.change(screen.getByLabelText('Place name'),{target:{value:'Work'}});
 expect(screen.getByRole('radio',{name:'No icon'})).toBeChecked();
 expect(screen.getByRole('radio',{name:'Home'})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('radio',{name:'Home'}));
 const radius=screen.getByRole('slider',{name:/Recognition radius/});
 expect(radius).toHaveAttribute('min','15');
 expect(radius).toHaveAttribute('max','50');
 expect(radius).toHaveValue('30');
 fireEvent.change(radius,{target:{value:'20'}});
 const sharing=screen.getByLabelText(/Share with my friends/);
 expect(sharing).not.toBeChecked();
 fireEvent.click(sharing);
 fireEvent.click(screen.getByRole('button',{name:'Save location'}));
 await waitFor(()=>expect(run).toHaveBeenCalledWith('savePlace',expect.objectContaining({
  name:'Work',icon:'home',latitude:3,longitude:4,radius:20,shareWithFriends:true
 })));
});

it('keeps an older Social radius until it is explicitly reduced',async()=>{
 const run=vi.fn().mockResolvedValue(true);
 const location={id:'school',owner_id:'me',name:'School',icon:'school',latitude:1,longitude:2,radius:120};
 render(<Places household selfId="me" places={[location]} run={run}/>);
 fireEvent.click(screen.getByRole('button',{name:'Edit School'}));
 expect(screen.getByRole('button',{name:'Choose map point'})).toHaveAttribute('data-radius','120');
 fireEvent.click(screen.getByRole('button',{name:'Save location'}));
 await screen.findByRole('button',{name:'Edit School'});
 expect(run).toHaveBeenLastCalledWith('savePlace',expect.objectContaining({radius:120}));
 fireEvent.click(screen.getByRole('button',{name:'Edit School'}));
 fireEvent.click(screen.getByRole('button',{name:'Reduce radius to 50 m'}));
 fireEvent.click(screen.getByRole('button',{name:'Save location'}));
 await waitFor(()=>expect(run).toHaveBeenLastCalledWith('savePlace',expect.objectContaining({radius:50})));
});
