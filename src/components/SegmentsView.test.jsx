import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const api=vi.hoisted(()=>({listSegments:vi.fn()}));
vi.mock('../lib/segmentsApi.js',async importOriginal=>({...(await importOriginal()),listSegments:api.listSegments}));
import SegmentsView from './SegmentsView.jsx';

const row=(id,extra={})=>({id,name:`Segment ${id}`,activity:'MTB',distance_meters:1250,creator_name:'Ann',mine:false,can_edit:false,status:'approved',visibility:'public',efforts:0,...extra});
beforeEach(()=>{vi.useFakeTimers();api.listSegments.mockReset().mockResolvedValue([row('a',{efforts:3}),row('b',{mine:true,creator_name:'Me'})]);});
afterEach(()=>{cleanup();vi.useRealTimers();});
const settle=async(ms=0)=>{await act(async()=>{vi.advanceTimersByTime(ms);await Promise.resolve();await Promise.resolve();});};
function view(props={}){
 const onOpen=vi.fn(),onOpenActivity=vi.fn(),onSync=vi.fn();
 render(<SegmentsView owner="me" journeys={[]} receipts={{}} onOpen={onOpen} onOpenActivity={onOpenActivity} onSync={onSync} {...props}/>);
 return {onOpen,onOpenActivity,onSync};
}

it('lists public segments by anyone, with creator, activity, distance and efforts, and opens one',async()=>{
 const {onOpen}=view();await settle(350);
 expect(api.listSegments).toHaveBeenCalledWith(expect.objectContaining({scope:'all',query:'',activity:'',area:null}));
 const first=screen.getByRole('button',{name:'Open segment Segment a'});
 expect(first).toHaveTextContent('Mountain biking · 1.3 km · by Ann');
 expect(first).toHaveTextContent('3 efforts');
 expect(screen.getByRole('button',{name:'Open segment Segment b'})).toHaveTextContent('Yours');
 fireEvent.click(first);expect(onOpen).toHaveBeenCalledWith('a');
});

it('searches after typing settles and filters by activity type',async()=>{
 view();await settle(350);api.listSegments.mockClear();
 fireEvent.change(screen.getByRole('searchbox',{name:'Search segments'}),{target:{value:'gro'}});
 fireEvent.change(screen.getByRole('searchbox',{name:'Search segments'}),{target:{value:'grove'}});
 await settle(100);expect(api.listSegments).not.toHaveBeenCalled();
 await settle(400);
 expect(api.listSegments).toHaveBeenCalledTimes(1);
 expect(api.listSegments).toHaveBeenLastCalledWith(expect.objectContaining({query:'grove'}));
 fireEvent.change(screen.getByRole('combobox',{name:'Activity type'}),{target:{value:'Running'}});await settle(400);
 expect(api.listSegments).toHaveBeenLastCalledWith(expect.objectContaining({query:'grove',activity:'Running'}));
});

it('Nearby asks for a location first, then searches the area around it',async()=>{
 const onLocate=vi.fn();
 const {rerender}=render(<SegmentsView owner="me" journeys={[]} receipts={{}} onOpen={vi.fn()} onLocate={onLocate}/>);await settle(350);
 fireEvent.click(screen.getByRole('button',{name:'Nearby'}));api.listSegments.mockClear();await settle(350);
 expect(api.listSegments).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Use my location'}));expect(onLocate).toHaveBeenCalled();
 rerender(<SegmentsView owner="me" journeys={[]} receipts={{}} onOpen={vi.fn()} position={{latitude:-34.5,longitude:150.85}}/>);await settle(350);
 const call=api.listSegments.mock.calls.at(-1)[0];
 expect(call.scope).toBe('nearby');
 expect(call.area.minLat).toBeLessThan(-34.5);expect(call.area.maxLat).toBeGreaterThan(-34.5);
});

it('Mine shows segments made on this iPhone that are waiting, failed or refused, with Retry',async()=>{
 const journeys=[{id:'ride',activity:'MTB',details:{namedSegments:[
  {id:'p1',name:'Waiting one',startIndex:1,endIndex:9},{id:'p2',name:'Failed one',startIndex:1,endIndex:9},
  {id:'p3',name:'Refused one',startIndex:1,endIndex:9},{id:'b',name:'Segment b',startIndex:1,endIndex:9}]}}];
 const receipts={'mtb-segment:p2':{owner:'me',fingerprint:'Failed one|1|9',failed:'Not published yet. It will retry on the next sync.'},
  'mtb-segment:p3':{owner:'me',fingerprint:'Refused one|1|9',skipped:'refused',reason:'The section crosses a GPS gap. Choose a section without one.'},
  'mtb-segment:b':{owner:'me',fingerprint:'Segment b|1|9',uploaded:true}};
 const {onOpenActivity,onSync}=view({journeys,receipts});
 fireEvent.click(screen.getByRole('button',{name:'Mine'}));await settle(350);
 expect(api.listSegments).toHaveBeenLastCalledWith(expect.objectContaining({scope:'mine'}));
 const local=within(screen.getByRole('list',{name:'Made on this iPhone'}));
 expect(local.getByRole('button',{name:/Waiting one/})).toHaveTextContent('Waiting to publish');
 expect(local.getByRole('button',{name:/Failed one/})).toHaveTextContent('will retry');
 expect(local.getByRole('button',{name:/Refused one/})).toHaveTextContent('Not published. The section crosses a GPS gap');
 // Published (and returned by the server) is not listed twice.
 expect(local.queryByRole('button',{name:/Segment b/})).toBeNull();
 fireEvent.click(local.getByRole('button',{name:/Refused one/}));expect(onOpenActivity).toHaveBeenCalledWith('ride');
 fireEvent.click(screen.getByRole('button',{name:/Retry now/}));expect(onSync).toHaveBeenCalled();
});

it('explains a load failure and retries',async()=>{
 api.listSegments.mockRejectedValueOnce(new Error('Segments could not be loaded.'));
 view();await settle(350);
 expect(screen.getByRole('alert')).toHaveTextContent('Segments could not be loaded.');
 fireEvent.click(screen.getByRole('button',{name:'Retry'}));await settle(350);
 expect(screen.getByRole('button',{name:'Open segment Segment a'})).toBeInTheDocument();
});

it('pages with Show more beyond the server’s 100-row request limit',async()=>{
 const all=Array.from({length:145},(_,i)=>row(`r${i}`));
 api.listSegments.mockImplementation(async({offset=0,limit})=>all.slice(offset,offset+Math.min(limit,100)));
 view();await settle(350);
 expect(screen.getAllByRole('button',{name:/^Open segment/})).toHaveLength(40);
 for(const shown of [80,120,145]){
  fireEvent.click(screen.getByRole('button',{name:'Show more segments'}));await settle(350);
  expect(screen.getAllByRole('button',{name:/^Open segment/})).toHaveLength(shown);
 }
 expect(api.listSegments.mock.calls.map(([args])=>args.offset)).toEqual([0,40,80,120]);
 expect(screen.queryByRole('button',{name:'Show more segments'})).toBeNull();
});

it('Nearby without a location never shows the previous list under its prompt',async()=>{
 view();await settle(350);
 expect(screen.getAllByRole('button',{name:/^Open segment/}).length).toBeGreaterThan(0);
 fireEvent.click(screen.getByRole('button',{name:'Nearby'}));await settle(350);
 expect(screen.getByText('Nearby needs your location.')).toBeInTheDocument();
 expect(screen.queryAllByRole('button',{name:/^Open segment/})).toHaveLength(0);
});

it('reloads when a segment was edited or deleted elsewhere',async()=>{
 const props={owner:'me',journeys:[],receipts:{},onOpen:vi.fn()};
 const {rerender}=render(<SegmentsView {...props} version={0}/>);await settle(350);
 const calls=api.listSegments.mock.calls.length;
 rerender(<SegmentsView {...props} version={1}/>);await settle(350);
 expect(api.listSegments.mock.calls.length).toBe(calls+1);
});
