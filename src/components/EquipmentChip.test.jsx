import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {EquipmentButton,EquipmentChip} from './EquipmentChip.jsx';
afterEach(cleanup);
const car={id:'car-1',name:'Geely',category:'car'};
const bike={id:'bike-1',name:'Trek',category:'bicycle'};
const drive={id:'d1',title:'Geely drive',activity:'Driving',source:'device'};

it('stays invisible when the activity or the Collection has nothing compatible',()=>{
 const {rerender}=render(<EquipmentChip trip={{...drive,activity:'Walking'}} items={[car]} fallback={<span>chevron</span>}/>);
 expect(screen.getByText('chevron')).toBeInTheDocument();
 rerender(<EquipmentChip trip={drive} items={[bike]} fallback={<span>chevron</span>}/>);
 expect(screen.getByText('chevron')).toBeInTheDocument();
 expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('offers a discreet add action, then shows the assigned item',()=>{
 const onOpen=vi.fn();
 const {rerender}=render(<EquipmentChip trip={drive} items={[car]} onOpen={onOpen} fallback={<span>chevron</span>}/>);
 expect(screen.queryByText('chevron')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Add equipment to Geely drive'}));
 expect(onOpen).toHaveBeenCalledWith(drive);
 rerender(<EquipmentChip trip={{...drive,equipment:[{id:'car-1',name:'Old name'}]}} items={[{...car,name:'Geely'}]} onOpen={onOpen}/>);
 const chip=screen.getByRole('button',{name:'Equipment: Geely. Change equipment'});
 expect(chip).toHaveTextContent('Geely');
 fireEvent.click(chip);
 expect(onOpen).toHaveBeenCalledTimes(2);
});

it('summarises several items without crowding the row',()=>{
 render(<EquipmentChip trip={{id:'k',title:'Kite session',activity:'Kitesurfing',source:'device',equipment:[{id:'kite',name:'Duotone 12'},{id:'board',name:'Twin tip'}]}} items={[{id:'kite',name:'Duotone 12',category:'kite'},{id:'board',name:'Twin tip',category:'board'}]} onOpen={vi.fn()}/>);
 expect(screen.getByRole('button',{name:'Equipment: Duotone 12. Change equipment'})).toHaveTextContent('Duotone 12 +1');
});

it('shows a Tesla vehicle as read-only equipment resolved from the car itself',()=>{
 const tesla={id:'t',title:'Tesla drive',activity:'Driving',source:'tesla',providerVehicleID:'provider-1'};
 const {rerender}=render(<EquipmentChip trip={tesla} items={[{...car,teslaVehicleID:'provider-1'}]} onOpen={vi.fn()} fallback={<span>chevron</span>}/>);
 expect(screen.getByLabelText('Vehicle: Geely')).toHaveTextContent('Geely');
 expect(screen.queryByRole('button')).not.toBeInTheDocument();
 rerender(<EquipmentChip trip={tesla} items={[]} onOpen={vi.fn()} fallback={<span>chevron</span>}/>);
 expect(screen.getByText('chevron')).toBeInTheDocument();
});

it('keeps a grouped journey summary read-only',()=>{
 render(<EquipmentChip trip={{id:'journey:a',isGroupedJourney:true,activity:'Driving',segments:[{id:'a',equipment:[{id:'car-1',name:'Geely'}]}]}} items={[car]} onOpen={vi.fn()} fallback={<span>chevron</span>}/>);
 expect(screen.getByLabelText('Vehicle: Geely')).toBeInTheDocument();
 expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('offers the same control on the activity detail screen',()=>{
 const onOpen=vi.fn();
 const {rerender}=render(<EquipmentButton trip={{...drive,equipment:[{id:'car-1',name:'Geely'}]}} items={[car]} onOpen={onOpen}/>);
 fireEvent.click(screen.getByRole('button',{name:'Equipment: Geely. Change equipment'}));
 expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({id:'d1'}));
 rerender(<EquipmentButton trip={drive} items={[car]} onOpen={onOpen}/>);
 expect(screen.getByRole('button',{name:'Add car'})).toBeInTheDocument();
 rerender(<EquipmentButton trip={drive} items={[]} onOpen={onOpen}/>);
 expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
