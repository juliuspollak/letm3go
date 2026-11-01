import {useState} from 'react';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import MapControls from './MapLayers.jsx';
import {DEFAULT_MAP_VIEW} from '../lib/mapLayers.js';
import {mapControls,panelChange,toolbarChange} from '../lib/mapToolbar.js';
afterEach(cleanup);
function Preview({initial=DEFAULT_MAP_VIEW,archived=0}){
 const [view,setView]=useState(initial),[panel,setPanel]=useState(null);
 return <><MapControls controls={mapControls(view,panel,['Driving','Walking','MTB','Kitesurfing'],'2026-10-30',archived)} onAction={id=>{if(id.startsWith('panel:'))setPanel(v=>panelChange(v,id));else setView(v=>toolbarChange(v,id));}}/><output data-testid="view">{JSON.stringify(view)}</output></>;
}
const click=name=>fireEvent.click(screen.getByRole('button',{name}));
const current=()=>JSON.parse(screen.getByTestId('view').textContent);
const pressed=name=>screen.getByRole('button',{name}).getAttribute('aria-pressed');
it('shows two labelled controls and no filter icons until a panel is opened',()=>{
 render(<Preview/>);
 expect(screen.getAllByRole('button').map(b=>b.textContent)).toEqual(['Filters','Layers']);
 expect(screen.queryByRole('group')).toBeNull();
});
it('opens, swaps and dismisses panels without a dialog and without changing a selection',()=>{
 render(<Preview initial={{...DEFAULT_MAP_VIEW,routes:'all',activity:'Walking'}}/>);
 const before=current();
 click(/^Filters/);expect(screen.getByRole('region',{name:'Filters'})).toBeInTheDocument();expect(screen.queryByRole('dialog')).toBeNull();
 click('Map layers');expect(screen.queryByRole('region',{name:'Filters'})).toBeNull();expect(screen.getByRole('region',{name:'Map layers'})).toBeInTheDocument();
 click('Close Map layers');expect(screen.queryByRole('region')).toBeNull();
 click(/^Filters/);click(/^Filters/);expect(screen.queryByRole('region')).toBeNull();
 click(/^Filters/);fireEvent.keyDown(document,{key:'Escape'});expect(screen.queryByRole('region')).toBeNull();
 expect(current()).toEqual(before);
});
it('keeps people independent and supports all exclusive route selections and off',()=>{
 render(<Preview/>);click('Filters');click('People & places');
 for(const [label,id] of [['Today','today'],['Favourites','pinned'],['All routes','all'],['Off',null]]){click(label);expect(current()).toMatchObject({routes:id,people:false});expect(pressed(label)).toBe('true');}
});
it('marks only choices that are applied, and keeps the panel open between them',()=>{
 render(<Preview initial={{...DEFAULT_MAP_VIEW,range:'30d'}}/>);click('Filters');
 // A saved range is not applied while routes are off, so it is not shown as applied.
 expect(pressed('Past 30 days')).toBe('false');expect(pressed('Off')).toBe('true');
 click('All routes');expect(pressed('Past 30 days')).toBe('true');expect(pressed('Any time')).toBe('false');
 click('One day');expect(pressed('One day')).toBe('true');expect(pressed('Past 30 days')).toBe('false');
 click('Today');expect(pressed('One day')).toBe('false');
});
it('steps through days from the date bar and returns to Today without opening a panel',()=>{
 render(<Preview initial={{...DEFAULT_MAP_VIEW,routes:'today'}}/>);
 const bar=()=>within(screen.getByRole('group',{name:'Selected day'}));
 expect(bar().getByRole('button',{name:'Next day'})).toBeDisabled();
 expect(bar().queryByRole('button',{name:'Return to Today'})).toBeNull();
 click('Previous day');expect(current()).toMatchObject({routes:'all',day:'2026-10-29'});
 click('Previous day');expect(current().day).toBe('2026-10-28');
 expect(bar().getByText(new Date('2026-10-28T12:00:00').toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short'}))).toBeInTheDocument();
 expect(screen.queryByRole('region')).toBeNull();
 click('Next day');expect(current().day).toBe('2026-10-29');
 click('Return to Today');expect(current().day).toBe('2026-10-30');
 expect(bar().getByText('Today')).toBeInTheDocument();
 click('Show all dates');expect(current()).toMatchObject({day:null,routes:'all'});
 expect(screen.queryByRole('group',{name:'Selected day'})).toBeNull();
});
it('keeps active filters readable with the panel closed',()=>{
 render(<Preview initial={{...DEFAULT_MAP_VIEW,people:false,routes:'all',activity:'MTB',range:'7d'}}/>);
 const button=screen.getByRole('button',{name:'Filters, 4 active: People hidden, All routes, Past 7 days, Mountain biking'});
 expect(button).toHaveTextContent('Filters · People hidden, All routes, Past 7 days, Mountain biking4');
 click(/^Filters/);click('Reset filters');
 expect(current()).toEqual(DEFAULT_MAP_VIEW);
 expect(screen.getByRole('button',{name:'Filters',expanded:true})).toHaveTextContent(/^Filters$/);
});
it('applies recorded activities, map style and Community trails from their own panels',()=>{
 render(<Preview/>);click('Filters');
 expect(screen.queryByRole('group',{name:'Activity'})).toBeNull();
 click('All routes');click('Mountain biking');expect(current().activity).toBe('MTB');click('All activities');expect(current().activity).toBe('');
 click('Map layers');click('Satellite');expect(current().style).toBe('satellite');expect(screen.getByRole('button',{name:'Map layers: Satellite'})).toBeInTheDocument();
 click('Community trails');expect(current()).toMatchObject({content:'trails',routes:'all'});
 // Trails is its own map: nothing to filter, and the way back stays open.
 expect(screen.queryByRole('button',{name:/^Filters/})).toBeNull();
 click('My map');expect(screen.getByRole('button',{name:/^Filters/})).toBeInTheDocument();
});
it('offers the archive filter only when something is archived',()=>{
 render(<Preview initial={{...DEFAULT_MAP_VIEW,routes:'all'}} archived={3}/>);click(/^Filters/);
 expect(pressed('Archived activities (3)')).toBe('true');
 click('Archived activities (3)');expect(current().archived).toBe(false);
 expect(screen.getByRole('button',{name:/^Filters, 2 active: All routes, Archived hidden/})).toBeInTheDocument();
 cleanup();render(<Preview initial={{...DEFAULT_MAP_VIEW,routes:'all'}}/>);click(/^Filters/);
 expect(screen.queryByRole('group',{name:'Archive'})).toBeNull();
});
