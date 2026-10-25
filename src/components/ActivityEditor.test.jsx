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
