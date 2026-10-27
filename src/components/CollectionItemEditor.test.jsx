import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import CollectionItemEditor from './CollectionItemEditor.jsx';
afterEach(cleanup);
const kiteItem={id:'kite-1',name:'Big kite',make:'Duotone',model:'Evo',category:'kite',attributes:{size:'12',style:'All-round'},photo:'data:image/jpeg;base64,AAAA',source:'manual'};

it('asks for a category first and then shows only that category’s fields',()=>{
 render(<CollectionItemEditor onSave={vi.fn()} onBack={vi.fn()}/>);
 expect(screen.getByText('Select a category to see its details.')).toBeInTheDocument();
 expect(screen.queryByRole('combobox',{name:/Brand/})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Bicycle'}));
 expect(screen.getByRole('combobox',{name:/Brand/})).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Type: Gravel'})).toBeInTheDocument();
 expect(screen.queryByLabelText('Size')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Kite'}));
 expect(screen.getByLabelText('Size')).toBeInTheDocument();
 expect(screen.getByText('m²')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Type: Wave'})).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Type: Gravel'})).not.toBeInTheDocument();
});

it('builds a car with its powertrain and brand suggestions',async()=>{
 const onSave=vi.fn().mockResolvedValue(true),onBack=vi.fn();
 render(<CollectionItemEditor onSave={onSave} onBack={onBack}/>);
 fireEvent.click(screen.getByRole('button',{name:'Car'}));
 fireEvent.change(screen.getByRole('textbox',{name:/Name/}),{target:{value:'Geely'}});
 fireEvent.change(screen.getByRole('combobox',{name:/Brand/}),{target:{value:'Geely'}});
 fireEvent.click(screen.getByRole('button',{name:'Powertrain: Electric'}));
 expect(screen.getByRole('button',{name:'Powertrain: Electric'})).toHaveAttribute('aria-pressed','true');
 fireEvent.click(screen.getByRole('button',{name:'Add item'}));
 await waitFor(()=>expect(onSave).toHaveBeenCalledWith(expect.objectContaining({name:'Geely',make:'Geely',category:'car',source:'manual',attributes:{powertrain:'Electric'}})));
 expect(onBack).toHaveBeenCalled();
});

it('edits an existing item without losing its details and confirms a category change',async()=>{
 const onSave=vi.fn().mockResolvedValue(true);
 render(<CollectionItemEditor item={kiteItem} onSave={onSave} onBack={vi.fn()}/>);
 expect(screen.getByRole('textbox',{name:/Name/})).toHaveValue('Big kite');
 expect(screen.getByLabelText('Size')).toHaveValue(12);
 expect(screen.getByRole('img',{name:/Big kite photo/})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Bicycle'}));
 expect(screen.getByRole('status')).toHaveTextContent('Changing to Bicycle removes Size, Type.');
 fireEvent.click(screen.getByRole('button',{name:'Keep Kite'}));
 expect(screen.getByLabelText('Size')).toHaveValue(12);
 fireEvent.click(screen.getByRole('button',{name:'Bicycle'}));
 fireEvent.click(screen.getByRole('button',{name:'Change category'}));
 expect(screen.queryByLabelText('Size')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Save item'}));
 await waitFor(()=>expect(onSave).toHaveBeenCalledWith(expect.objectContaining({id:'kite-1',category:'bicycle',photo:kiteItem.photo,attributes:{}})));
});

it('refuses to save an item with no name, brand or model',async()=>{
 const onSave=vi.fn();
 render(<CollectionItemEditor onSave={onSave} onBack={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'Kite'}));
 fireEvent.click(screen.getByRole('button',{name:'Add item'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Add a name, brand or model');
 expect(onSave).not.toHaveBeenCalled();
});
