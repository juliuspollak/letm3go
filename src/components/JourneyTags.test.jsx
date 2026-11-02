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
