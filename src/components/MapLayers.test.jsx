import {useState} from 'react';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import MapLayers,{MapLayersButton} from './MapLayers.jsx';
import {DEFAULT_MAP_VIEW} from '../lib/mapLayers.js';
import {mapToolbar,toolbarChange} from '../lib/mapToolbar.js';
afterEach(cleanup);
function Preview(){
 const [view,setView]=useState(DEFAULT_MAP_VIEW),[open,setOpen]=useState(false),[category,setCategory]=useState(null);
 return <><MapLayersButton onClick={()=>setOpen(v=>!v)}/><MapLayers toolbar={mapToolbar(view,open,category,['Driving','Walking','MTB','Kitesurfing'],'2026-10-30')} onClose={()=>setOpen(false)} onAction={id=>{if(['mode','routes','calendar','activity'].includes(id))setCategory(v=>v===id?null:id);else setView(v=>toolbarChange(v,id));}}/><output data-testid="view">{JSON.stringify(view)}</output></>;
}
const click=name=>fireEvent.click(screen.getByRole('button',{name,exact:true}));
const current=()=>JSON.parse(screen.getByTestId('view').textContent);
it('opens inline, switches strips, collapses and closes without a dialog',()=>{
 render(<Preview/>);click('Map layers');
 expect(screen.getByRole('toolbar')).toBeInTheDocument();expect(screen.queryByRole('dialog')).toBeNull();
 click('Routes');expect(screen.getByRole('group',{name:'Routes'})).toBeInTheDocument();
 click('Calendar');expect(screen.queryByRole('group',{name:'Routes'})).toBeNull();
 click('Calendar');expect(screen.queryByRole('group')).toBeNull();
 click('Map layers');expect(screen.queryByRole('toolbar')).toBeNull();
 click('Map layers');fireEvent.keyDown(document,{key:'Escape'});expect(screen.queryByRole('toolbar')).toBeNull();
});
it('keeps people independent and supports all exclusive route selections and off',()=>{
 render(<Preview/>);click('Map layers');click('People & places');click('Routes');
 for(const [label,id] of [['Today','today'],['Favourites','pinned'],['All routes','all'],['Routes off',null]]){click(label);expect(current()).toMatchObject({routes:id,people:false});}
});
it('navigates days, returns to today, retains ranges and applies recorded activities',()=>{
 render(<Preview/>);click('Map layers');click('Calendar');click('Previous day');
 expect(current()).toMatchObject({routes:'all',day:'2026-10-29'});
 click('Next day');expect(current().day).toBe('2026-10-30');
 click('Previous day');click('Return to Today');expect(current().day).toBe('2026-10-30');
 click('Past 30 days');expect(current()).toMatchObject({day:null,range:'30d'});
 click('Activity');click('MTB');expect(current().activity).toBe('MTB');click('All activities');expect(current().activity).toBe('');
 click('Map type');click('Community trails');expect(current()).toMatchObject({content:'trails',range:'30d'});
 expect(screen.queryByRole('button',{name:'Calendar'})).toBeNull();click('My routes');expect(current().range).toBe('30d');
});
