import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import TripsList from './TripsList.jsx';
import {TRIP_PAGE_SIZE} from '../lib/tripsList.js';
afterEach(cleanup);

// Rows are delegated from the list container, so every test renders the real
// component with the smallest set of props App passes.
const trip=(id,extra={})=>({id,title:`Ride ${id}`,activity:'Cycling',source:'device',date:'2026-02-14',startedAt:1_700_000_000,endedAt:1_700_000_600,durationSeconds:600,distanceMeters:4200,stops:[],...extra});
function renderList(overrides={}){
 const props={journeys:[],unit:'km',sort:'newest',query:'',favourites:[],vehicles:[],busy:false,showArchived:false,mergeSource:null,mergeTarget:null,onOpen:vi.fn(),onBookmark:vi.fn(),onEquipment:vi.fn(),onArchive:vi.fn(),onDelete:vi.fn(),onRestore:vi.fn(),onMergeSelect:vi.fn(),onMergeTarget:vi.fn(),...overrides};
 return {...render(<TripsList {...props}/>),props};
}

it('renders one page of activities and appends the next page on demand',()=>{
 const journeys=Array.from({length:TRIP_PAGE_SIZE+5},(_,index)=>trip(`t${index}`));
 const {container}=renderList({journeys});
 const rows=()=>container.querySelectorAll('.trip-list-row');
 expect(rows()).toHaveLength(TRIP_PAGE_SIZE);
 expect(screen.queryByRole('button',{name:'Open Ride t44'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Show more activities'}));
 expect(rows()).toHaveLength(TRIP_PAGE_SIZE+5);
 expect(screen.getByRole('button',{name:'Open Ride t44'})).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Show more activities'})).not.toBeInTheDocument();
});

it('opens a row, saves a favourite and archives it from the revealed actions',()=>{
 const journeys=[trip('a'),trip('b')];
 const {props}=renderList({journeys,favourites:['a']});
 fireEvent.click(screen.getByRole('button',{name:'Open Ride a'}));
 expect(props.onOpen).toHaveBeenCalledWith(journeys[0]);
 fireEvent.click(screen.getByRole('button',{name:'Add to favourites: Ride b'}));
 expect(props.onBookmark).toHaveBeenCalledWith('b');
 fireEvent.click(screen.getByRole('button',{name:'Archive: Ride a'}));
 expect(props.onArchive).toHaveBeenCalledWith(journeys[0]);
 expect(props.onRestore).not.toHaveBeenCalled();
});

it('restores from an archived list, where the same action means the opposite',()=>{
 const {props}=renderList({journeys:[trip('a')],showArchived:true});
 const restore=screen.getByRole('button',{name:'Restore: Ride a'});
 expect(restore).toHaveTextContent('Restore');
 fireEvent.click(restore);
 expect(props.onRestore).toHaveBeenCalledWith('a');
 expect(props.onArchive).not.toHaveBeenCalled();
});

it('asks for a merge partner instead of opening the trip when the merge button is used',()=>{
 const {props}=renderList({journeys:[trip('a')]});
 fireEvent.click(screen.getByRole('button',{name:'Select Ride a to merge'}));
 expect(props.onMergeSelect).toHaveBeenCalledWith('a');
 expect(props.onMergeTarget).toHaveBeenCalledWith(null);
 expect(props.onOpen).not.toHaveBeenCalled();
});

it('explains why a search matched a row',()=>{
 renderList({journeys:[trip('a',{tags:['gravel']}),trip('b')],query:'grav'});
 const row=screen.getByRole('button',{name:'Open Ride a'});
 expect(row).toHaveTextContent('Matched tag: gravel');
 expect(screen.getByRole('button',{name:'Open Ride b'})).toHaveTextContent('Matched trip details: grav');
});

it('keeps the same row elements when a recorder poll republishes the list',()=>{
 const journeys=[trip('a'),trip('b')];
 const {container,rerender,props}=renderList({journeys});
 const before=[...container.querySelectorAll('.trip-list-row')];
 // A poll hands over a brand new array with the same journey objects and new inline
 // callbacks; memoised rows must survive it untouched.
 rerender(<TripsList {...props} journeys={[...journeys]} onOpen={()=>{}} favourites={[]}/>);
 const after=[...container.querySelectorAll('.trip-list-row')];
 expect(after).toHaveLength(2);
 after.forEach((row,index)=>expect(row).toBe(before[index]));
 expect(screen.getByRole('button',{name:'Open Ride a'})).toBeInTheDocument();
});

it('reveals Delete as well as Archive without deleting on the swipe itself',()=>{
 const ride=trip('watch',{source:'watch'});const {container,props}=renderList({journeys:[ride]});
 const row=container.querySelector('[data-trip-id]');
 fireEvent.touchStart(row,{touches:[{clientX:250,clientY:100}]});
 fireEvent.touchMove(row,{touches:[{clientX:150,clientY:100}]});fireEvent.touchEnd(row);
 expect(container.querySelector('.trip-swipe-surface').style.transform).toBe('translateX(-198px)');
 expect(props.onDelete).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Delete: Ride watch'}));
 expect(props.onDelete).toHaveBeenCalledWith(ride);
});
it('a held touch followed by vertical scrolling never starts merge or blocks scrolling',()=>{
 vi.useFakeTimers();
 try{
  const {container,props}=renderList({journeys:[trip('drive',{activity:'Driving'})]});
  const row=container.querySelector('[data-trip-id]');
  fireEvent.touchStart(row,{touches:[{clientX:180,clientY:100}]});vi.advanceTimersByTime(500);
  const move=new Event('touchmove',{bubbles:true,cancelable:true});Object.defineProperty(move,'touches',{value:[{clientX:180,clientY:250}]});fireEvent(row,move);
  expect(move.defaultPrevented).toBe(false);expect(props.onMergeSelect).not.toHaveBeenCalled();expect(container.querySelector('.merge-floating-card')).toBeNull();
  expect(row).toHaveAttribute('draggable','false');
 }finally{vi.useRealTimers();}
});
it('does not offer deletion of shared, remote or active records',()=>{
 renderList({journeys:[trip('shared',{readOnly:true,source:'watch'}),trip('provider',{source:'tesla'}),trip('live',{state:'recording',endedAt:null})]});
 expect(screen.queryByRole('button',{name:/^Delete:/})).not.toBeInTheDocument();
});
it('restores an archived activity on a full swipe instead of archiving it again',()=>{
 const {container,props}=renderList({journeys:[trip('a')],showArchived:true});const row=container.querySelector('[data-trip-id]');
 fireEvent.touchStart(row,{touches:[{clientX:350,clientY:100}]});fireEvent.touchMove(row,{touches:[{clientX:10,clientY:100}]});fireEvent.touchEnd(row);
 expect(props.onRestore).toHaveBeenCalledWith('a');expect(props.onArchive).not.toHaveBeenCalled();
});
