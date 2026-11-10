import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const api=vi.hoisted(()=>({segmentDetail:vi.fn(),updateSegment:vi.fn(),deleteSegment:vi.fn()}));
vi.mock('../lib/segmentsApi.js',async importOriginal=>({...(await importOriginal()),...api}));
const mapProps=vi.hoisted(()=>({value:null}));
vi.mock('./JourneyMap.jsx',()=>({default:props=>{mapProps.value=props;return <div aria-label="Segment map"/>;}}));
import SegmentDetail from './SegmentDetail.jsx';

const geometry=Array.from({length:21},(_,i)=>[-34.5+i*0.00018,150.85]);
const segment=(extra={})=>({id:'s1',name:'Grove climb',activity:'MTB',description:'',status:'approved',visibility:'public',deleted:false,version:1,geometry,distance_meters:400,
 created_at:'2026-11-01T00:00:00Z',creator_name:'Ann',mine:false,can_edit:false,stats:{efforts:4,athletes:2,best_seconds:95,my_efforts:1,my_best_seconds:130},...extra});
beforeEach(()=>{for(const fn of Object.values(api))fn.mockReset();api.updateSegment.mockResolvedValue(2);api.deleteSegment.mockResolvedValue();});
afterEach(cleanup);
const flush=()=>act(async()=>{await Promise.resolve();await Promise.resolve();});

it('shows the route, distance, creator and effort statistics to anyone, without edit actions',async()=>{
 api.segmentDetail.mockResolvedValue(segment());
 render(<SegmentDetail id="s1"/>);await flush();
 expect(screen.getByRole('heading',{name:'Grove climb'})).toBeInTheDocument();
 expect(screen.getByText(/0\.4 km · Created by Ann/)).toBeInTheDocument();
 expect(mapProps.value.segmentLayer[0].geometry).toHaveLength(21);
 expect(screen.getByText('Best time').nextSibling).toHaveTextContent('1:35');
 expect(screen.getByText('Your best').nextSibling).toHaveTextContent('2:10');
 expect(screen.getByText('People').nextSibling).toHaveTextContent('2');
 for(const name of [/Rename/,/Start & finish/,/Delete/,/Replace route/])expect(screen.queryByRole('button',{name})).toBeNull();
 expect(screen.queryByText(/Replace route/)).toBeNull();
});

it('lets the creator rename it',async()=>{
 api.segmentDetail.mockResolvedValue(segment({mine:true,can_edit:true,creator_name:'Me'}));
 const onChanged=vi.fn();
 render(<SegmentDetail id="s1" onChanged={onChanged}/>);await flush();
 fireEvent.click(screen.getByRole('button',{name:/Rename/}));
 fireEvent.change(screen.getByRole('textbox',{name:'Name'}),{target:{value:'Grove climb (upper)'}});
 fireEvent.click(screen.getByRole('button',{name:'Save name'}));await flush();
 expect(api.updateSegment).toHaveBeenCalledWith('s1',{name:'Grove climb (upper)'});
 expect(onChanged).toHaveBeenCalledWith('s1');
 expect(api.segmentDetail).toHaveBeenCalledTimes(2);
});

it('moves start and finish along the route and saves only the kept part as a new version',async()=>{
 api.segmentDetail.mockResolvedValue(segment({mine:true,can_edit:true}));
 render(<SegmentDetail id="s1"/>);await flush();
 fireEvent.click(screen.getByRole('button',{name:/Start & finish/}));
 const save=screen.getByRole('button',{name:'Save start & finish'});
 expect(save).toBeDisabled();
 fireEvent.change(screen.getByRole('slider',{name:'Start'}),{target:{value:'3'}});
 fireEvent.change(screen.getByRole('slider',{name:'Finish'}),{target:{value:'15'}});
 expect(mapProps.value.segmentLayer[0].geometry).toHaveLength(13);
 fireEvent.click(save);await flush();
 expect(api.updateSegment).toHaveBeenCalledWith('s1',{geometry:geometry.slice(3,16),note:'start and finish moved'});
 // Too short to be a segment: refused before reaching the server.
 fireEvent.click(screen.getByRole('button',{name:/Start & finish/}));
 fireEvent.change(screen.getByRole('slider',{name:'Start'}),{target:{value:'10'}});
 fireEvent.change(screen.getByRole('slider',{name:'Finish'}),{target:{value:'12'}});
 expect(screen.getByRole('button',{name:'Save start & finish'})).toBeDisabled();
 expect(screen.getByText(/needs at least 50 m and 5 points/)).toBeInTheDocument();
});

it('an admin sees that the creator is told, and deleting asks first and never mentions changing activities',async()=>{
 api.segmentDetail.mockResolvedValue(segment({can_edit:true,mine:false}));
 const onDeleted=vi.fn();
 render(<SegmentDetail id="s1" onDeleted={onDeleted}/>);await flush();
 expect(screen.getByText(/editing someone else’s segment as an admin/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:/Delete/}));
 expect(api.deleteSegment).not.toHaveBeenCalled();
 const dialog=screen.getByRole('alertdialog',{name:'Delete segment'});
 expect(dialog).toHaveTextContent('its creator is told');
 expect(dialog).toHaveTextContent('Activities, including the one it was made from, are not changed.');
 fireEvent.click(screen.getByRole('button',{name:'Delete segment'}));await flush();
 expect(api.deleteSegment).toHaveBeenCalledWith('s1');expect(onDeleted).toHaveBeenCalledWith('s1');
});

it('shows the server’s refusal and keeps the segment unchanged',async()=>{
 api.segmentDetail.mockResolvedValue(segment({mine:true,can_edit:true}));
 api.updateSegment.mockRejectedValue(new Error('You may not edit this segment.'));
 render(<SegmentDetail id="s1"/>);await flush();
 fireEvent.click(screen.getByRole('button',{name:/Rename/}));
 fireEvent.change(screen.getByRole('textbox',{name:'Name'}),{target:{value:'Other'}});
 fireEvent.click(screen.getByRole('button',{name:'Save name'}));await flush();
 expect(screen.getByRole('alert')).toHaveTextContent('You may not edit this segment.');
});

it('replaces the route from a GPX file after validating it',async()=>{
 api.segmentDetail.mockResolvedValue(segment({mine:true,can_edit:true}));
 render(<SegmentDetail id="s1"/>);await flush();
 const points=Array.from({length:8},(_,i)=>`<trkpt lat="${-34.6+i*0.0002}" lon="150.9"/>`).join('');
 const file=new File([`<gpx><trk><trkseg>${points}</trkseg></trk></gpx>`],'route.gpx',{type:'application/gpx+xml'});
 fireEvent.change(screen.getByLabelText(/Replace route/),{target:{files:[file]}});
 await flush();await flush();
 expect(api.updateSegment).toHaveBeenCalledWith('s1',{geometry:expect.arrayContaining([[-34.6,150.9]]),note:'route replaced from GPX'});
 expect(api.updateSegment.mock.calls[0][1].geometry).toHaveLength(8);
});

it('says when a segment was deleted or cannot be found',async()=>{
 api.segmentDetail.mockResolvedValueOnce(segment({deleted:true}));
 render(<SegmentDetail id="s1"/>);await flush();
 expect(screen.getByText(/This segment was deleted/)).toBeInTheDocument();
 cleanup();api.segmentDetail.mockResolvedValueOnce(null);
 render(<SegmentDetail id="s2"/>);await flush();
 expect(screen.getByText('This segment is no longer available.')).toBeInTheDocument();
});
