import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('./ActivityPrivacy.jsx',()=>({default:()=>null}));
const mapStats=vi.hoisted(()=>({renders:0}));
vi.mock('./JourneyMap.jsx',()=>({default:({embeddedEnabled=true})=>{
 mapStats.renders+=1;
 return <div aria-label={embeddedEnabled?'Interactive Apple map':'Static map preview'}/>;
}}));
import ActivityDetail from './ActivityDetail.jsx';
import {recordedJourney} from '../lib/recorder.js';
afterEach(cleanup);
const trip=recordedJourney({id:'drive',activity:'Driving',state:'finished',source:'device',recordingMode:'automatic',startedAt:1000,endedAt:1100,distanceMeters:1000,durationSeconds:100,points:[{latitude:1,longitude:2,timestamp:1000,segment:0},{latitude:3,longitude:4,timestamp:1100,segment:0}]});
it('shows an interactive Apple map directly on trip details',()=>{
 render(<ActivityDetail trip={trip}/>);
 expect(screen.getByLabelText('Interactive Apple map')).toBeInTheDocument();
 expect(screen.queryByLabelText('Static map preview')).not.toBeInTheDocument();
});
it('explains that only the same activity continues a published stop',()=>{
 render(<ActivityDetail trip={{...trip,provisional:true,continuationEndsAt:Date.now()/1000+600}}/>);
 const notice=screen.getByRole('status');
 expect(notice).toHaveTextContent('Stopped and saved to History');
 expect(notice).toHaveTextContent('10 minutes remain for the same activity near here');
 expect(notice).toHaveTextContent('A different activity (walking after parking, or driving after a walk) is saved as its own journey.');
});
it('lets an unfinished automatic drive be viewed without offering edits to a finished-only native record',()=>{
 render(<ActivityDetail trip={{...trip,state:'recording',endedAt:null}}/>);
 expect(screen.getByRole('status')).toHaveTextContent('Automatic recording in progress');
 expect(screen.getByLabelText('Interactive Apple map')).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Edit activity'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Delete activity'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Save visible route'})).not.toBeInTheDocument();
});
it('leads the detail with the recorded numbers instead of making them be hunted for',()=>{
 render(<ActivityDetail trip={trip}/>);
 const readout=screen.getByLabelText('Activity summary');
 expect(readout).toHaveTextContent('Distance');
 expect(readout).toHaveTextContent('1.0 km');
 expect(readout).toHaveTextContent('Time');
 expect(readout).toHaveTextContent('1 min');
});
it('adds a suggested photo only after the person selects and confirms it',async()=>{
 const run=vi.fn(async method=>{
  if(method==='suggestPhotos')return {suggestions:[{assetID:'asset-1',thumbnail:'data:image/jpeg;base64,one',captureTime:1050}],limited:false};
  if(method==='acceptSuggestion')return {trips:[trip]};
  return null;
 });
 render(<ActivityDetail trip={trip} run={run} onUpdated={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'Find journey photos'}));
 expect(await screen.findByRole('heading',{name:'Photo suggestions'})).toBeInTheDocument();
 expect(screen.getByText(/Showing locally available photos captured during this activity/)).toBeInTheDocument();
 expect(run).toHaveBeenCalledWith('suggestPhotos','drive');
 expect(run).not.toHaveBeenCalledWith('acceptSuggestion',expect.anything());
 fireEvent.click(screen.getByRole('checkbox',{name:/Suggested photo, .*not selected/}));
 fireEvent.click(screen.getByRole('button',{name:'Add 1 photo'}));
 await waitFor(()=>expect(run).toHaveBeenCalledWith('acceptSuggestion',{id:'drive',assetID:'asset-1'}));
 await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('1 added'));
});
it('says when photo access is limited so an empty list is not read as "none exist"',async()=>{
 const run=vi.fn(async()=>({suggestions:[],limited:true}));
 render(<ActivityDetail trip={trip} run={run} onUpdated={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'Find journey photos'}));
 expect(await screen.findByText(/limited to selected photos/)).toBeInTheDocument();
 expect(screen.getByText(/No photos from your library were captured/)).toBeInTheDocument();
});
it('keeps one map and never re-embeds it when the details sheet moves',()=>{
 render(<ActivityDetail trip={trip}/>);
 const map=screen.getByLabelText('Interactive Apple map');
 const renders=mapStats.renders;
 fireEvent.keyDown(screen.getByRole('slider',{name:'Resize activity details'}),{key:'ArrowUp'});
 expect(screen.getByRole('region',{name:'Activity details'})).toHaveAttribute('data-detent','full');
 expect(screen.getAllByLabelText('Interactive Apple map')).toHaveLength(1);
 expect(screen.getByLabelText('Interactive Apple map')).toBe(map);
 expect(mapStats.renders).toBe(renders);
});
it('shows moments above the technical settings so photos are not buried',()=>{
 render(<ActivityDetail trip={{...trip,coverPhotoID:'photo-1',photos:[{id:'photo-1',url:'data:image/jpeg;base64,one',caption:'Summit'}]}}/>);
 const moments=screen.getByLabelText('Moments and photos');
 const settings=screen.getByRole('heading',{name:'Route shown on map'});
 expect(moments.compareDocumentPosition(settings)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(moments).toHaveTextContent('1 photo');
 expect(screen.getByRole('button',{name:'Add photos'})).toBeInTheDocument();
});
