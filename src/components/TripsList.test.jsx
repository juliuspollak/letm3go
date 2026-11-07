import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import TripsList from './TripsList.jsx';
import {TRIP_PAGE_SIZE,TRIP_PREFETCH_BATCH_SIZE} from '../lib/tripsList.js';
afterEach(cleanup);
// jsdom does not implement PointerEvent; preserve pointer identity and coordinates.
function pointer(row,type,x=0,y=0){
 const event=new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y});
 Object.defineProperties(event,{pointerType:{value:'touch'},isPrimary:{value:true},pointerId:{value:1}});
 fireEvent(row,event);
 return event;
}

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
 // Check the row boundary directly; global role queries repeatedly resolve the
 // accessible names/styles of every swipe action and can exhaust CI's timeout.
 expect(container.querySelector('[data-trip-id="t44"]')).toBeNull();
 const more=screen.getByText('Show more activities',{selector:'button'});
 expect(more).toHaveAccessibleName('Show more activities');
 fireEvent.click(more);
 expect(rows()).toHaveLength(TRIP_PAGE_SIZE+5);
 const last=container.querySelector('[data-trip-id="t44"]');
 expect(last).toBeInTheDocument();
 expect(within(last).getByRole('button',{name:'Open Ride t44'})).toBeInTheDocument();
 expect(screen.queryByText('Show more activities',{selector:'button'})).not.toBeInTheDocument();
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
 pointer(row,'pointerdown',250,100);
 pointer(row,'pointermove',150,100);pointer(row,'pointerup');
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
  pointer(row,'pointerdown',180,100);vi.advanceTimersByTime(500);
  const move=pointer(row,'pointermove',180,250);
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
 pointer(row,'pointerdown',350,100);pointer(row,'pointermove',10,100);pointer(row,'pointerup');
 expect(props.onRestore).toHaveBeenCalledWith('a');expect(props.onArchive).not.toHaveBeenCalled();
});

it('marks a distance that includes estimated GPS gaps with ~, in both sort layouts',()=>{
 const estimate={estimatedMeters:59462,recordedMeters:3188,gapCount:9,roadGaps:9};
 const journeys=[trip('gap',{activity:'Driving',distanceMeters:59462,distance:59.5,distanceEstimate:estimate}),trip('ok',{distanceMeters:4200,distance:4.2})];
 const {container,unmount}=renderList({journeys});
 const text=[...container.querySelectorAll('.recent-activity-distance')].map(n=>n.textContent);
 expect(text).toEqual(['~59 km','4.2 km']);
 expect(container.querySelector('[title="Estimated: includes GPS gaps"]')).toBeInTheDocument();
 unmount();
 const sorted=renderList({journeys,sort:'duration'}).container;
 expect([...sorted.querySelectorAll('.trip-time-distance')].map(n=>n.textContent)).toEqual(['~59 km','4.2 km']);
});

it('cancels a horizontal preview when the browser takes over a gesture',()=>{
 const {container,props}=renderList({journeys:[trip('a')]});
 const row=container.querySelector('[data-trip-id]');
 pointer(row,'pointerdown',250,100);pointer(row,'pointermove',150,100);
 expect(row).toHaveClass('trip-swiping');
 pointer(row,'pointercancel');
 expect(row).not.toHaveClass('trip-swiping');
 expect(row.querySelector('.trip-swipe-surface').style.transform).toBe('');
 expect(props.onArchive).not.toHaveBeenCalled();
});

it('reobserves the sentinel after each page so continuous scrolling loads beyond page two',()=>{
 const observers=[];
 vi.stubGlobal('IntersectionObserver',class{
  constructor(callback){this.callback=callback;this.observe=vi.fn();this.disconnect=vi.fn();observers.push(this);}
 });
 try{
  const {container}=renderList({journeys:Array.from({length:TRIP_PAGE_SIZE*3+1},(_,i)=>trip(`t${i}`))});
  for(let page=1;page<=9;page++){
   const observer=observers.at(-1);
   act(()=>observer.callback([{isIntersecting:true}]));
   expect(observer.disconnect).toHaveBeenCalled();
   expect(container.querySelectorAll('.trip-list-row')).toHaveLength(Math.min(TRIP_PAGE_SIZE+page*TRIP_PREFETCH_BATCH_SIZE,TRIP_PAGE_SIZE*3+1));
  }
 }finally{vi.unstubAllGlobals();}
});

it('shows who shared an activity with me as an avatar, and who can see mine',()=>{
 const friendsRow=trip('theirs',{title:'Beach ride',isShared:true,readOnly:true,sharedOwnerID:'f1',ownerName:'Ava'});
 const mine=trip('mine',{title:'Morning ride'}),privateOne=trip('private',{title:'Solo ride'});
 const sharing={mine:{audience:'friends',household:true,friends:[{id:'f2',name:'Ben'},{id:'f3',name:'Cal'},{id:'f4',name:'Dee'},{id:'f5',name:'Eve'}]}};
 const {container}=renderList({journeys:[friendsRow,mine,privateOne],sharing,photos:{}});
 const rows=[...container.querySelectorAll('.trip-list-row')];
 // Shared with me: the owner's avatar, no extra label row; it cannot be swiped or deleted.
 expect(within(rows[0]).getByRole('img',{name:'Ava avatar'})).toBeInTheDocument();
 expect(within(rows[0]).getByText(/Shared by Ava/)).toHaveClass('sr-only');
 expect(rows[0].querySelector('.trip-swipe-actions')).toBeNull();
 // Mine: a compact indicator with the household and up to three friends.
 expect(within(rows[1]).getByLabelText('Shared with household and 4 friends')).toBeInTheDocument();
 expect(within(rows[1]).getAllByRole('img').map(img=>img.getAttribute('aria-label'))).toEqual(['Ben avatar','Cal avatar','Dee avatar']);
 expect(within(rows[1]).getByText('+1')).toBeInTheDocument();
 // Not shared: nothing extra.
 expect(rows[2].querySelector('.trip-sharing')).toBeNull();
});
it('marks a public link on my activity',()=>{
 const {container}=renderList({journeys:[trip('pub')],sharing:{pub:{audience:'public',household:false,friends:[]}}});
 expect(container.querySelector('[aria-label="Shared by public link"]')).toBeInTheDocument();
});
