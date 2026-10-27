import { render,screen,fireEvent,waitFor,cleanup } from '@testing-library/react';
import { it,expect,vi,afterEach } from 'vitest';
import ActivityEditor from './ActivityEditor.jsx';
afterEach(cleanup);
it('saves an activity correction using the header action outside the form',async()=>{
 const result={trips:[{id:'trip'}]},run=vi.fn().mockResolvedValue(result),saved=vi.fn();
 render(<ActivityEditor trip={{id:'trip',title:'Shopping',activity:'Walking',tags:[]}} vehicles={[]} run={run} onSaved={saved}/>);
 fireEvent.change(screen.getByLabelText('Activity'),{target:{value:'Driving'}});
 fireEvent.click(screen.getByRole('button',{name:'Save activity'}));
 await waitFor(()=>expect(run).toHaveBeenCalledWith('editActivity',expect.objectContaining({id:'trip',activity:'Driving'})));
 expect(saved).toHaveBeenCalledWith(result,'trip');
});
it('assigns Collection equipment by id so renaming an item never breaks the link',async()=>{
 const run=vi.fn().mockResolvedValue({trips:[{id:'trip'}]});
 render(<ActivityEditor trip={{id:'trip',title:'Drive',activity:'Driving',tags:[],vehicle:'Old name',vehicleID:'car-1'}} vehicles={[{id:'car-1',name:'Geely',category:'car'},{id:'car-2',name:'Kia',category:'car'},{id:'bike',name:'Trek',category:'bicycle',archived:true}]} run={run} onSaved={vi.fn()}/>);
 const select=screen.getByRole('combobox',{name:'Equipment'});
 expect(select).toHaveValue('car-1');
 expect(screen.getByRole('option',{name:'Geely · Car'})).toBeInTheDocument();
 expect(screen.queryByRole('option',{name:/Trek/})).not.toBeInTheDocument();
 fireEvent.change(select,{target:{value:'car-2'}});
 fireEvent.click(screen.getByRole('button',{name:'Save activity'}));
 await waitFor(()=>expect(run).toHaveBeenCalledWith('editActivity',expect.objectContaining({vehicle:'Kia',vehicleID:'car-2'})));
});
it('keeps a saved equipment label when its Collection item is no longer selectable',()=>{
 const run=vi.fn();
 render(<ActivityEditor trip={{id:'trip',title:'Drive',activity:'Driving',tags:[],vehicle:'Sold car',vehicleID:'gone'}} vehicles={[]} run={run} onSaved={vi.fn()}/>);
 expect(screen.getByRole('option',{name:'Sold car (saved with this activity)'})).toBeInTheDocument();
 expect(screen.getByRole('combobox',{name:'Equipment'})).toHaveValue('__saved');
});
