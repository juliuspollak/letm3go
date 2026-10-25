import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {it,expect,vi,afterEach} from 'vitest';
import JourneyGroupingPanel from './JourneyGroupingPanel.jsx';
afterEach(cleanup);
it('requires explicit selection for manual merging and exposes reasoned suggestions and undo',async()=>{
 const act=vi.fn(async()=>true),close=vi.fn();
 const grouping={act,busy:false,metadata:{history:[{}]},suggestions:[{id:'edge',segmentIDs:['a','b'],reason:'Overnight continuation — confirm',stop:{name:'Kew'}}]};
 render(<JourneyGroupingPanel activities={[{id:'a',title:'To Kew',activity:'Driving',startedAt:100,endedAt:200,distance:20},{id:'b',title:'To Gold Coast',activity:'Driving',startedAt:300,endedAt:400,distance:30}]} grouping={grouping} onClose={close}/>);
 expect(screen.getByRole('button',{name:'Merge selected activities'})).toBeDisabled();
 expect(screen.getByText('Overnight continuation — confirm')).toBeInTheDocument();expect(act).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Keep separate'}));expect(act).toHaveBeenCalledWith({type:'split',after:'a',before:'b'});
 const boxes=screen.getAllByRole('checkbox');fireEvent.click(boxes[0]);fireEvent.click(boxes[1]);fireEvent.click(screen.getByRole('button',{name:'Merge selected activities'}));expect(act).toHaveBeenCalledWith({type:'merge',ids:['a','b']});
 fireEvent.click(screen.getByRole('button',{name:'Undo last grouping change'}));expect(act).toHaveBeenCalledWith({type:'undo'});
});
