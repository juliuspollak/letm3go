import {useState} from 'react';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import MapFilters from './MapFilters.jsx';
import {mapLayerJourneys} from '../lib/mapLayers.js';
afterEach(cleanup);
const journeys=[{id:'today',date:'2026-10-27'},{id:'saved',date:'2026-10-26'}];
function Preview(){
 const [layers,setLayers]=useState(['people']);
 return <><MapFilters value={layers} onChange={setLayers}/><p data-testid="routes">{mapLayerJourneys(journeys,layers,'2026-10-27',['saved']).map(trip=>trip.id).join(',')}</p></>;
}
it('starts with people selected behind a single icon-only filter button',()=>{
 render(<Preview/>);
 const trigger=screen.getByRole('button',{name:'Map filters'});
 expect(trigger).toHaveAttribute('aria-expanded','false');
 expect(trigger).toHaveTextContent('');
 expect(screen.getByRole('status')).toHaveTextContent('People & places');
 expect(screen.queryByRole('button',{name:'Today’s activities'})).not.toBeInTheDocument();
 expect(screen.getByTestId('routes')).toBeEmptyDOMElement();
});
it('applies selections immediately and stays open for another tap',()=>{
 render(<Preview/>);
 fireEvent.click(screen.getByRole('button',{name:'Map filters'}));
 const people=screen.getByRole('button',{name:'People & places'});
 const today=screen.getByRole('button',{name:'Today’s activities'});
 expect(people).toHaveAttribute('aria-pressed','true');
 fireEvent.click(today);
 expect(today).toHaveAttribute('aria-pressed','true');
 expect(people).toHaveAttribute('aria-pressed','true');
 expect(screen.getByTestId('routes')).toHaveTextContent('today');
 fireEvent.click(people);
 expect(people).toHaveAttribute('aria-pressed','false');
 expect(today).toHaveAttribute('aria-pressed','true');
 expect(screen.getByTestId('routes')).toHaveTextContent('today');
 expect(screen.getByRole('button',{name:'Map filters'})).toHaveAttribute('aria-expanded','true');
});
it('changes the activity scope while retaining the people selection',()=>{
 render(<Preview/>);
 fireEvent.click(screen.getByRole('button',{name:'Map filters'}));
 fireEvent.click(screen.getByRole('button',{name:'Today’s activities'}));
 fireEvent.click(screen.getByRole('button',{name:'Favourite activities'}));
 expect(screen.getByRole('button',{name:'Today’s activities'})).toHaveAttribute('aria-pressed','false');
 expect(screen.getByRole('button',{name:'Favourite activities'})).toHaveAttribute('aria-pressed','true');
 expect(screen.getByRole('button',{name:'People & places'})).toHaveAttribute('aria-pressed','true');
 expect(screen.getByTestId('routes')).toHaveTextContent('saved');
});
it('closes on Escape and restores focus to the filter icon',()=>{
 render(<Preview/>);
 const trigger=screen.getByRole('button',{name:'Map filters'});
 fireEvent.click(trigger);
 const option=screen.getByRole('button',{name:'All activities'});option.focus();
 fireEvent.keyDown(option,{key:'Escape'});
 expect(trigger).toHaveAttribute('aria-expanded','false');
 expect(trigger).toHaveFocus();
});
