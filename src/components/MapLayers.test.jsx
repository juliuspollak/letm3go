import {useState} from 'react';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import MapLayers,{MapLayersButton} from './MapLayers.jsx';
import {DEFAULT_MAP_VIEW,activeLayerCount} from '../lib/mapLayers.js';
afterEach(cleanup);

function Preview({initial=DEFAULT_MAP_VIEW,activities=['Cycling','Walking']}){
 const [view,setView]=useState(initial),[open,setOpen]=useState(false);
 return <><MapLayersButton active={activeLayerCount(view)} onClick={()=>setOpen(true)}/><MapLayers open={open} view={view} onChange={setView} onClose={()=>setOpen(false)} activities={activities}/><output data-testid="view">{JSON.stringify(view)}</output></>;
}
const current=()=>JSON.parse(screen.getByTestId('view').textContent);
const openSheet=()=>{fireEvent.click(screen.getByRole('button',{name:/^Map layers/}));return screen.getByRole('dialog',{name:'Map layers'});};

it('is one labelled button that opens a sheet and closes on Done, Escape and outside tap',()=>{
 render(<Preview/>);
 expect(screen.queryByRole('dialog')).toBeNull();
 fireEvent.click(within(openSheet()).getByRole('button',{name:'Done'}));
 expect(screen.queryByRole('dialog')).toBeNull();
 openSheet();
 fireEvent.keyDown(document,{key:'Escape'});
 expect(screen.queryByRole('dialog')).toBeNull();
 openSheet();
 fireEvent.click(document.querySelector('.map-layers-backdrop'));
 expect(screen.queryByRole('dialog')).toBeNull();
});
it('applies toggles at once and keeps the sheet open; route layers are one at a time; people are independent',()=>{
 render(<Preview/>);
 const sheet=openSheet();
 fireEvent.click(within(sheet).getByRole('button',{name:'Today'}));
 fireEvent.click(within(sheet).getByRole('button',{name:'All routes'}));
 expect(within(sheet).getByRole('button',{name:'All routes'})).toHaveAttribute('aria-pressed','true');
 expect(within(sheet).getByRole('button',{name:'Today'})).toHaveAttribute('aria-pressed','false');
 fireEvent.click(within(sheet).getByRole('switch',{name:'People & places'}));
 expect(current()).toMatchObject({routes:'all',people:false});
 expect(screen.getByRole('dialog',{name:'Map layers'})).toBeInTheDocument();
 // Choosing the selected layer again turns routes off; people stay as they are.
 fireEvent.click(within(sheet).getByRole('button',{name:'All routes'}));
 expect(current()).toMatchObject({routes:null,people:false});
});
it('offers activity and date filters only where they apply, and clears them',()=>{
 render(<Preview/>);
 const sheet=openSheet();
 expect(within(sheet).queryByRole('combobox')).toBeNull();
 fireEvent.click(within(sheet).getByRole('button',{name:'Today'}));
 expect(within(sheet).getByRole('combobox',{name:'Activity'})).toBeInTheDocument();
 expect(within(sheet).queryByRole('combobox',{name:'Date'})).toBeNull();
 fireEvent.click(within(sheet).getByRole('button',{name:'All routes'}));
 fireEvent.change(within(sheet).getByRole('combobox',{name:'Activity'}),{target:{value:'Cycling'}});
 fireEvent.change(within(sheet).getByRole('combobox',{name:'Date'}),{target:{value:'30d'}});
 expect(current()).toMatchObject({activity:'Cycling',range:'30d'});
 expect(screen.getByRole('button',{name:'Map layers, 3 active'})).toBeInTheDocument();
 fireEvent.click(within(sheet).getByRole('button',{name:'Clear filters'}));
 expect(current()).toMatchObject({routes:'all',activity:'',range:'any'});
});
it('hides the activity filter when no activity types exist',()=>{
 render(<Preview initial={{...DEFAULT_MAP_VIEW,routes:'all'}} activities={[]}/>);
 const sheet=openSheet();
 expect(within(sheet).queryByRole('combobox',{name:'Activity'})).toBeNull();
 expect(within(sheet).getByRole('combobox',{name:'Date'})).toBeInTheDocument();
});
it('switches between My routes and Community trails and closes, hiding options that do not apply',()=>{
 const change=vi.fn();
 render(<MapLayers open view={DEFAULT_MAP_VIEW} onChange={change} onClose={vi.fn()}/>);
 expect(screen.getByRole('radio',{name:'My routes'})).toHaveAttribute('aria-checked','true');
 fireEvent.click(screen.getByRole('radio',{name:'Community trails'}));
 expect(change).toHaveBeenCalledWith(expect.objectContaining({content:'trails'}));
 cleanup();
 render(<MapLayers open view={{...DEFAULT_MAP_VIEW,content:'trails'}} onChange={change} onClose={vi.fn()}/>);
 expect(screen.queryByRole('switch',{name:'People & places'})).toBeNull();
 expect(screen.queryByRole('button',{name:'All routes'})).toBeNull();
});
it('shows an unobtrusive indicator only when something differs from the default',()=>{
 const {rerender}=render(<MapLayersButton active={0}/>);
 expect(screen.getByRole('button',{name:'Map layers'}).querySelector('.map-layers-dot')).toBeNull();
 rerender(<MapLayersButton active={1}/>);
 expect(screen.getByRole('button',{name:'Map layers, 1 active'}).querySelector('.map-layers-dot')).not.toBeNull();
});
