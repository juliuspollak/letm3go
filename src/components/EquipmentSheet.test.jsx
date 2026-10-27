import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import EquipmentSheet from './EquipmentSheet.jsx';
afterEach(cleanup);
const car={id:'car-1',name:'Geely',make:'Geely',model:'X3',category:'car',attributes:{powertrain:'Electric'}};
const other={id:'car-2',name:'Kia',make:'Kia',model:'EV6',category:'car'};
const bike={id:'bike-1',name:'Trek Marlin',make:'Trek',category:'bicycle'};
const kite={id:'kite-1',name:'Duotone 12',make:'Duotone',category:'kite',attributes:{size:'12'}};
const board={id:'board-1',name:'Twin tip',make:'Duotone',category:'board',attributes:{size:'138'}};
const vehicles=[car,other,bike,kite,board];
const drive={id:'drive-1',title:'Geely drive',activity:'Driving',source:'device',equipment:[{id:'car-1',name:'Geely'}]};

it('offers only compatible equipment, marks the current item and assigns in one tap',async()=>{
 const onAssign=vi.fn().mockResolvedValue(true),onClose=vi.fn();
 render(<EquipmentSheet trip={{id:'drive-2',title:'New drive',activity:'Driving',source:'device'}} vehicles={vehicles} onAssign={onAssign} onClose={onClose}/>);
 expect(screen.getByRole('button',{name:'Use Geely'})).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Use Kia'})).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:/Trek Marlin/})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:/Duotone/})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Use Geely'}));
 await waitFor(()=>expect(onAssign).toHaveBeenCalledWith(['car-1']));
 expect(onClose).toHaveBeenCalled();
});

it('shows the assigned item, allows changing it and removing it',async()=>{
 const onAssign=vi.fn().mockResolvedValue(true),onClose=vi.fn();
 const {rerender}=render(<EquipmentSheet trip={drive} vehicles={vehicles} onAssign={onAssign} onClose={onClose}/>);
 expect(screen.getByRole('button',{name:'Use Geely'})).toHaveAttribute('aria-pressed','true');
 expect(screen.getByRole('button',{name:'Use Kia'})).toHaveAttribute('aria-pressed','false');
 fireEvent.click(screen.getByRole('button',{name:'Remove from this activity'}));
 await waitFor(()=>expect(onAssign).toHaveBeenCalledWith([]));
 rerender(<EquipmentSheet trip={drive} vehicles={vehicles} onAssign={onAssign} onClose={onClose}/>);
 fireEvent.click(screen.getByRole('button',{name:'Use Kia'}));
 await waitFor(()=>expect(onAssign).toHaveBeenLastCalledWith(['car-2']));
});

it('lets a kitesurfing session hold a kite and a board together',async()=>{
 const onAssign=vi.fn().mockResolvedValue(true),onClose=vi.fn();
 render(<EquipmentSheet trip={{id:'kite-trip',title:'Kite session',activity:'Kitesurfing',source:'device',equipment:[{id:'kite-1',name:'Duotone 12'}]}} vehicles={vehicles} onAssign={onAssign} onClose={onClose}/>);
 expect(screen.getByRole('button',{name:'Toggle Duotone 12'})).toHaveAttribute('aria-pressed','true');
 fireEvent.click(screen.getByRole('button',{name:'Toggle Twin tip'}));
 await waitFor(()=>expect(onAssign).toHaveBeenCalledWith(['kite-1','board-1']));
 expect(onClose).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Toggle Twin tip'}));
 await waitFor(()=>expect(onAssign).toHaveBeenLastCalledWith(['kite-1']));
});

it('keeps an archived assignment visible and removable',async()=>{
 const archived={...car,id:'car-9',name:'Sold car',archived:true};
 const onAssign=vi.fn().mockResolvedValue(true);
 render(<EquipmentSheet trip={{id:'d',title:'Old drive',activity:'Driving',source:'device',equipment:[{id:'car-9',name:'Sold car'}]}} vehicles={[archived,other]} onAssign={onAssign} onClose={vi.fn()}/>);
 expect(screen.getByText('Archived')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Remove from this activity'}));
 await waitFor(()=>expect(onAssign).toHaveBeenCalledWith([]));
});

it('explains what to add when nothing compatible exists yet, without assigning silently',async()=>{
 const onAssign=vi.fn(),onAddItem=vi.fn().mockResolvedValue(true);
 render(<EquipmentSheet trip={{id:'kite-trip',title:'Kite session',activity:'Kitesurfing',source:'device'}} vehicles={[car]} onAssign={onAssign} onAddItem={onAddItem} onClose={vi.fn()}/>);
 expect(screen.getByText('Add your kite or board to choose it here.')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Add to Collection'}));
 fireEvent.click(screen.getByRole('button',{name:'Kite'}));
 fireEvent.change(screen.getByRole('textbox',{name:/Name/}),{target:{value:'Duotone 12'}});
 fireEvent.click(screen.getByRole('button',{name:'Add item'}));
 await waitFor(()=>expect(onAddItem).toHaveBeenCalledWith(expect.objectContaining({name:'Duotone 12',category:'kite'})));
 expect(onAssign).not.toHaveBeenCalled();
});

it('reports a failed assignment instead of pretending it saved',async()=>{
 const onAssign=vi.fn().mockResolvedValue(false),onClose=vi.fn();
 render(<EquipmentSheet trip={{id:'d',title:'Drive',activity:'Driving',source:'device'}} vehicles={vehicles} onAssign={onAssign} onClose={onClose}/>);
 fireEvent.click(screen.getByRole('button',{name:'Use Kia'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved');
 expect(onClose).not.toHaveBeenCalled();
});
