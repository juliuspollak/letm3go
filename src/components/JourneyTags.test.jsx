import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {it,expect,vi,afterEach} from 'vitest';
import JourneyTags from './JourneyTags.jsx';
afterEach(cleanup);
it('opens stable destination visits with activity dates without assuming identical trails',async()=>{
 const trip={id:'a',activity:'Walking',tags:['Reserve'],recognition:{primary:{placeID:'apple:park'}},points:[]};
 const other={...trip,id:'b',title:'Another walk'};
 const grouping={metadata:{},act:vi.fn(),journeys:[trip,other],destinations:[{placeID:'apple:park',name:'Reserve',visits:2,activities:[{id:'b',title:'Another walk',startedAt:1793000000}]}]};
 const open=vi.fn();const {container}=render(<JourneyTags trip={trip} grouping={grouping} onActivity={open}/>);
 const details=container.querySelector('details');details.open=true;fireEvent(details,new Event('toggle'));
 const button=await screen.findByRole('button',{name:/Another walk/});
 expect(screen.getByText('Same destination; different or unverified route')).toBeInTheDocument();
 fireEvent.click(button);expect(open).toHaveBeenCalledWith(other);
 expect(screen.getByText('Reserve — Visited 2 times')).toBeInTheDocument();
});
it('keeps hide-tag corrections in the existing account grouping action',async()=>{
 const act=vi.fn().mockResolvedValue(true);
 render(<JourneyTags trip={{id:'a',activity:'Walking',tags:['Reserve']}} grouping={{metadata:{},act}}/>);
 fireEvent.click(screen.getByRole('button',{name:'Hide tag Reserve'}));
 await waitFor(()=>expect(act).toHaveBeenCalledWith({type:'hideTag',anchor:'a',tag:'Reserve'}));
});
it('offers the tags already in the journal as the person types',async()=>{
 const act=vi.fn().mockResolvedValue(true);
 const journeys=[{id:'b',startedAt:1793000000,tags:['Bunnings','Coffee']}];
 const trip={id:'a',activity:'Driving',tags:[],points:[{latitude:-34.4,longitude:150.9,timestamp:1790000000,accuracy:5}]};
 render(<JourneyTags trip={trip} grouping={{metadata:{},act,journeys}}/>);
 fireEvent.change(screen.getByLabelText('New custom tag'),{target:{value:'bun'}});
 fireEvent.click(await screen.findByRole('option',{name:'Bunnings'}));
 await waitFor(()=>expect(act).toHaveBeenCalledWith({type:'manualTags',anchor:'a',tags:['Bunnings']}));
 expect(await screen.findByRole('status')).toHaveTextContent('Tag added to this trip only.');
});
it('reuses the spelling already in use instead of adding a near duplicate',async()=>{
 const act=vi.fn().mockResolvedValue(true);
 const journeys=[{id:'b',startedAt:1793000000,tags:['Coffee']}];
 const trip={id:'a',activity:'Walking',tags:[],points:[]};
 render(<JourneyTags trip={trip} grouping={{metadata:{},act,journeys}}/>);
 fireEvent.change(screen.getByLabelText('New custom tag'),{target:{value:'coffee'}});
 fireEvent.click(screen.getByRole('button',{name:/Add tag/}));
 await waitFor(()=>expect(act).toHaveBeenCalledWith({type:'manualTags',anchor:'a',tags:['Coffee']}));
});
it('remembers the destination even when that tag is already on the trip',async()=>{
 const act=vi.fn().mockResolvedValue(true);
 const run=vi.fn().mockResolvedValue({places:[]});
 const trip={id:'a',activity:'Driving',tags:['Bunnings'],points:[{latitude:-34.4,longitude:150.9,timestamp:1790000000,accuracy:5}]};
 render(<JourneyTags trip={trip} grouping={{metadata:{manualTags:{a:['Bunnings']},act},journeys:[trip]}} run={run}/>);
 expect(screen.getByText(/Tags describe this trip only/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('checkbox',{name:/Remember this destination/}));
 fireEvent.change(screen.getByLabelText('New custom tag'),{target:{value:'bunnings'}});
 fireEvent.click(screen.getByRole('button',{name:'Remember'}));
 await waitFor(()=>expect(run).toHaveBeenCalledWith('savePlace',{name:'Bunnings',kind:'favourite',latitude:-34.4,longitude:150.9,radius:200}));
 expect(act).not.toHaveBeenCalled();
 expect(await screen.findByRole('status')).toHaveTextContent('Saved Bunnings as a place.');
});
it('names a tag that is already on the trip instead of offering to remember it',async()=>{
 const act=vi.fn().mockResolvedValue(true);
 const trip={id:'a',activity:'Driving',tags:['Bunnings'],points:[{latitude:-34.4,longitude:150.9,timestamp:1790000000,accuracy:5}]};
 render(<JourneyTags trip={trip} grouping={{metadata:{manualTags:{a:['Bunnings']},act},journeys:[trip]}} run={vi.fn()}/>);
 fireEvent.change(screen.getByLabelText('New custom tag'),{target:{value:'Bunnings'}});
 expect(screen.getByRole('button',{name:/Already on this trip/})).toBeDisabled();
 expect(screen.getByText(/That tag is already on this trip. Turn on “Remember the destination”/)).toBeInTheDocument();
 // Turning the toggle on gives the press something to do.
 fireEvent.click(screen.getByRole('checkbox',{name:/Remember this destination/}));
 expect(screen.getByRole('button',{name:/Remember/})).toBeEnabled();
 expect(act).not.toHaveBeenCalled();
});
it('says it once when a tag already on the trip is submitted from the keyboard',async()=>{
 const act=vi.fn().mockResolvedValue(true);
 const trip={id:'a',activity:'Driving',tags:['Bunnings'],points:[]};
 const {container}=render(<JourneyTags trip={trip} grouping={{metadata:{manualTags:{a:['Bunnings']},act}}}/>);
 fireEvent.change(screen.getByLabelText('New custom tag'),{target:{value:'Bunnings'}});
 fireEvent.submit(container.querySelector('form'));
 await waitFor(()=>expect(screen.getByRole('status')).toBeInTheDocument());
 expect(screen.getAllByText(/That tag is already on this trip/)).toHaveLength(1);
 expect(act).not.toHaveBeenCalled();
});
it('keeps the tag when saving the place fails, and names the half still outstanding',async()=>{
 const act=vi.fn().mockResolvedValue(true);
 const run=vi.fn().mockResolvedValue(null);
 const trip={id:'a',activity:'Driving',tags:[],points:[{latitude:-34.4,longitude:150.9,timestamp:1790000000,accuracy:5}]};
 render(<JourneyTags trip={trip} grouping={{metadata:{},act}} run={run} lastError={()=>'The recorder is offline.'}/>);
 fireEvent.click(screen.getByRole('checkbox',{name:/Remember this destination/}));
 fireEvent.change(screen.getByLabelText('New custom tag'),{target:{value:'Bunnings'}});
 fireEvent.click(screen.getByRole('button',{name:/Remember/}));
 await waitFor(()=>expect(act).toHaveBeenCalledWith({type:'manualTags',anchor:'a',tags:['Bunnings']}));
 // The reason comes from the recorder rather than being guessed, and the tag that
 // did land is not reported as a failed press.
 expect(await screen.findByRole('status')).toHaveTextContent('Tag added to this trip only. The recorder is offline. Try again to save the destination.');
 expect(screen.getByLabelText('New custom tag')).toHaveValue('Bunnings');
 expect(screen.getByRole('checkbox',{name:/Remember this destination/})).toBeChecked();
});
it('keeps the saved place when the tag write fails, and retrying finishes it',async()=>{
 const act=vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
 const run=vi.fn().mockResolvedValue({places:[]});
 const trip={id:'a',activity:'Driving',tags:[],points:[{latitude:-34.4,longitude:150.9,timestamp:1790000000,accuracy:5}]};
 render(<JourneyTags trip={trip} grouping={{metadata:{},act}} run={run}/>);
 fireEvent.click(screen.getByRole('checkbox',{name:/Remember this destination/}));
 fireEvent.change(screen.getByLabelText('New custom tag'),{target:{value:'Bunnings'}});
 fireEvent.click(screen.getByRole('button',{name:/Remember/}));
 await waitFor(()=>expect(run).toHaveBeenCalledWith('savePlace',{name:'Bunnings',kind:'favourite',latitude:-34.4,longitude:150.9,radius:200}));
 expect(await screen.findByRole('status')).toHaveTextContent('Saved Bunnings as a place. Future trips ending within 200 m are named Bunnings. The tag was not added. Try again to add it.');
 expect(screen.getByLabelText('New custom tag')).toHaveValue('Bunnings');
 fireEvent.click(screen.getByRole('button',{name:/Remember/}));
 await waitFor(()=>expect(act).toHaveBeenCalledTimes(2));
 expect(await screen.findByRole('status')).toHaveTextContent('Saved Bunnings as a place. Future trips ending within 200 m are named Bunnings.');
 expect(screen.getByLabelText('New custom tag')).toHaveValue('');
});
it('does not write twice when the press is repeated while the first is in flight',async()=>{
 let release=()=>{};
 const act=vi.fn(()=>new Promise(resolve=>{release=()=>resolve(true);}));
 const trip={id:'a',activity:'Driving',tags:[],points:[]};
 render(<JourneyTags trip={trip} grouping={{metadata:{},act}}/>);
 fireEvent.change(screen.getByLabelText('New custom tag'),{target:{value:'Bunnings'}});
 const submit=screen.getByRole('button',{name:/Add tag/});
 fireEvent.click(submit);
 await waitFor(()=>expect(submit).toBeDisabled());
 fireEvent.click(submit);
 expect(act).toHaveBeenCalledTimes(1);
 release();
 await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Tag added to this trip only.'));
 expect(act).toHaveBeenCalledTimes(1);
});
it('says which destination is already recognised',()=>{
 const trip={id:'a',activity:'Driving',tags:[],points:[{latitude:-34.4,longitude:150.9,timestamp:1790000000,accuracy:5}]};
 const places={p:{id:'11111111-1111-4111-8111-111111111111',name:'Bunnings',kind:'favourite',latitude:-34.4,longitude:150.9,radius:200}};
 render(<JourneyTags trip={trip} grouping={{metadata:{places:{}},journeys:[]}} places={Object.values(places)}/>);
 expect(screen.getByText('Saved place: trips ending within 200 m of Bunnings are named Bunnings.')).toBeInTheDocument();
});
// grouping.metadata.places is the provider lookup cache ("lat,lon" -> lookup), not
// the saved places: reading it as saved places never found one.
it('reads saved places, not the provider lookup cache, to say a destination is already saved',()=>{
 const trip={id:'a',activity:'Driving',tags:[],points:[{latitude:-34.4,longitude:150.9,timestamp:1790000000,accuracy:5}]};
 const lookupCache={'-34.4000,150.9000':{nearbyName:'Bunnings',locality:'Shellharbour',candidates:[]}};
 render(<JourneyTags trip={trip} grouping={{metadata:{places:lookupCache},journeys:[]}} places={[]}/>);
 expect(screen.queryByText(/^Saved place:/)).not.toBeInTheDocument();
});

