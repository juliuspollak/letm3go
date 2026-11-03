import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import SegmentLibrary from './SegmentLibrary.jsx';

const points=Array.from({length:40},(_,i)=>({latitude:-34.4+i*0.0001,longitude:150.9,timestamp:1000+i*2,accuracy:5,altitude:0,speed:5,segment:0}));
const ride={id:'r',title:'Morning',updatedAt:1,points,details:{namedSegments:[{id:'s',name:'Rock',startIndex:2,endIndex:30,startTimestamp:points[2].timestamp,endTimestamp:points[30].timestamp,durationSeconds:56,colorIndex:1,updatedAt:1}]}};
afterEach(cleanup);

describe('My Segments',()=>{
 it('says how to make the first one',()=>{
  render(<SegmentLibrary journeys={[]} run={vi.fn()}/>);
  expect(screen.getByText('No segments yet')).toBeInTheDocument();
 });
 it('renames through the recorder',async()=>{
  const run=vi.fn().mockResolvedValue({});
  render(<SegmentLibrary journeys={[ride]} run={run}/>);
  fireEvent.click(screen.getByRole('button',{name:'Rock'}));
  fireEvent.change(screen.getByLabelText('Name'),{target:{value:'Rock Garden'}});
  fireEvent.click(screen.getByRole('button',{name:'Save name'}));
  await waitFor(()=>expect(run).toHaveBeenCalledWith('saveNamedSegment',{id:'r',segmentID:'s',name:'Rock Garden',start:2,end:30}));
 });
 it('asks before deleting',async()=>{
  const run=vi.fn().mockResolvedValue({});
  render(<SegmentLibrary journeys={[ride]} run={run}/>);
  fireEvent.click(screen.getByRole('button',{name:'Rock'}));
  fireEvent.click(screen.getByRole('button',{name:'Delete'}));
  expect(run).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Delete segment'}));
  await waitFor(()=>expect(run).toHaveBeenCalledWith('deleteNamedSegment',{id:'r',segmentID:'s'}));
 });
 it('hands a section change to the ride that holds it',()=>{
  const onChangeSection=vi.fn();
  render(<SegmentLibrary journeys={[ride]} run={vi.fn()} onChangeSection={onChangeSection}/>);
  fireEvent.click(screen.getByRole('button',{name:'Rock'}));
  fireEvent.click(screen.getByRole('button',{name:'Change section'}));
  expect(onChangeSection).toHaveBeenCalledWith(expect.objectContaining({id:'s',activityID:'r'}));
 });
});
