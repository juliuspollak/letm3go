import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {StrictMode} from 'react';
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
 fireEvent.click(screen.getByRole('button',{name:'Add Selected (1)'}));
 await waitFor(()=>expect(run).toHaveBeenCalledWith('acceptSuggestion',{id:'drive',assetID:'asset-1'}));
 await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('1 added'));
});
it('shows the native reason a photo action failed instead of a generic message',async()=>{
 const run=vi.fn(async()=>null);
 const lastError=vi.fn(()=>'Photo access was not granted. You can still add selected photos using the picker.');
 render(<ActivityDetail trip={trip} run={run} lastError={lastError}/>);
 fireEvent.click(screen.getByRole('button',{name:'Find journey photos'}));
 expect(await screen.findByText('Photo access was not granted. You can still add selected photos using the picker.')).toBeInTheDocument();
});
it('reports a partially imported photo selection by name instead of only the native error',async()=>{
 const added={id:'photo-1',url:'data:image/jpeg;base64,one',caption:'First'};
 const updated={...trip,localPhotos:[added]};
 const run=vi.fn(async method=>method==='pickPhotos'
  ?{trips:[updated],photoResults:{selected:2,added:1,failed:['Second photo could not be read.']}}
  :null);
 render(<ActivityDetail trip={trip} run={run} onUpdated={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'Add photos'}));
 expect(await screen.findByText('1 photo added · 1 could not be added: Second photo could not be read.')).toBeInTheDocument();
 await waitFor(()=>expect(screen.getByRole('button',{name:'Add photos'})).toBeEnabled());
 expect(run).toHaveBeenCalledWith('pickPhotos','drive');
});
it('reports a photo already kept instead of claiming it was added again',async()=>{
 const kept={id:'photo-1',url:'data:image/jpeg;base64,one',caption:'First'};
 const updated={...trip,localPhotos:[kept]};
 const run=vi.fn(async method=>method==='pickPhotos'
  ?{trips:[updated],photoResults:{selected:1,added:0,duplicates:1,failed:[]}}
  :null);
 render(<ActivityDetail trip={{...trip,localPhotos:[kept]}} run={run} onUpdated={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'Add photos'}));
 expect(await screen.findByText('1 photo already with this activity.')).toBeInTheDocument();
});
it('presents the photo picker only once for a double tap',async()=>{
 let finish;
 const run=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
 render(<ActivityDetail trip={trip} run={run} onUpdated={vi.fn()}/>);
 const button=screen.getByRole('button',{name:'Add photos'});
 fireEvent.click(button);fireEvent.click(button);
 expect(run).toHaveBeenCalledTimes(1);
 await act(async()=>finish({trips:[trip]}));
 await waitFor(()=>expect(button).toBeEnabled());
});
it('does not start a second suggestion search for a double tap',async()=>{
 let finish;
 const run=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
 render(<ActivityDetail trip={trip} run={run} onUpdated={vi.fn()}/>);
 const button=screen.getByRole('button',{name:'Find journey photos'});
 fireEvent.click(button);fireEvent.click(button);
 expect(run).toHaveBeenCalledTimes(1);
 await act(async()=>finish({suggestions:[],hasMore:false,total:0,limited:false}));
 expect(await screen.findByRole('heading',{name:'Photo suggestions'})).toBeInTheDocument();
});
it('does not reopen suggestions when Cancel happens while a page is loading',async()=>{
 let finishPage;
 const run=vi.fn(async (method,_id,options)=>{
  if(method!=='suggestPhotos')return null;
  if(options)return new Promise(resolve=>{finishPage=resolve;});
  return {suggestions:[{assetID:'asset-1',thumbnail:'data:image/jpeg;base64,one',captureTime:1050}],hasMore:true,total:2,limited:false,nextOffset:1};
 });
 render(<ActivityDetail trip={trip} run={run} onUpdated={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'Find journey photos'}));
 fireEvent.click(await screen.findByRole('button',{name:'Load more photos'}));
 fireEvent.click(screen.getByRole('button',{name:'Cancel'}));
 expect(screen.queryByRole('heading',{name:'Photo suggestions'})).not.toBeInTheDocument();
 await act(async()=>finishPage({suggestions:[{assetID:'asset-2',thumbnail:'data:image/jpeg;base64,two',captureTime:1060}],hasMore:false,total:2,limited:false}));
 expect(screen.queryByRole('heading',{name:'Photo suggestions'})).not.toBeInTheDocument();
});
it('loads the next page of suggestions instead of stopping at the first thirty',async()=>{
 const run=vi.fn(async (method,_id,options)=>{
  if(method==='suggestPhotos')return options
   ?{suggestions:[{assetID:'asset-2',thumbnail:'data:image/jpeg;base64,two',captureTime:1060}],limited:false,hasMore:false,total:2}
   :{suggestions:[{assetID:'asset-1',thumbnail:'data:image/jpeg;base64,one',captureTime:1050}],limited:false,hasMore:true,total:2};
  return null;
 });
 render(<ActivityDetail trip={trip} run={run} onUpdated={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'Find journey photos'}));
 expect(await screen.findByText(/Showing 1 of 2 photos/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Load more photos'}));
 await waitFor(()=>expect(run).toHaveBeenCalledWith('suggestPhotos','drive',{offset:1,limit:30}));
 await waitFor(()=>expect(screen.getAllByRole('checkbox',{name:/Suggested photo,/})).toHaveLength(2));
 expect(screen.queryByRole('button',{name:'Load more photos'})).not.toBeInTheDocument();
});
it('asks for the next page with the cursor native returned, so a page with undecodable thumbnails cannot trap the list',async()=>{
 const run=vi.fn(async (method,_id,options)=>{
  if(method!=='suggestPhotos')return null;
  // Page 1: 30 rows from Photos, but only one thumbnail could be read.
  if(!options)return {suggestions:[{assetID:'asset-1',thumbnail:'data:image/jpeg;base64,one',captureTime:1050}],limited:false,hasMore:true,total:31,nextOffset:30};
  return {suggestions:[{assetID:'asset-31',thumbnail:'data:image/jpeg;base64,x',captureTime:2200}],limited:false,hasMore:false,total:31,nextOffset:31};
 });
 render(<ActivityDetail trip={trip} run={run} onUpdated={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'Find journey photos'}));
 await screen.findByRole('button',{name:'Load more photos'});
 fireEvent.click(screen.getByRole('button',{name:'Load more photos'}));
 await waitFor(()=>expect(run).toHaveBeenCalledWith('suggestPhotos','drive',{offset:30,limit:30}));
 await waitFor(()=>expect(screen.getAllByRole('checkbox',{name:/Suggested photo,/})).toHaveLength(2));
});
it('steps over an appended page that renders nothing instead of looking complete',async()=>{
 const run=vi.fn(async (method,_id,options)=>{
  if(method!=='suggestPhotos')return null;
  if(!options)return {suggestions:[{assetID:'asset-1',thumbnail:'data:image/jpeg;base64,one',captureTime:1050}],limited:false,hasMore:true,total:61,nextOffset:30};
  if(options.offset===30)return {suggestions:[],limited:false,hasMore:true,total:61,nextOffset:60};
  return {suggestions:[{assetID:'asset-61',thumbnail:'data:image/jpeg;base64,x',captureTime:3200}],limited:false,hasMore:false,total:61,nextOffset:61};
 });
 render(<ActivityDetail trip={trip} run={run} onUpdated={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'Find journey photos'}));
 await screen.findByRole('button',{name:'Load more photos'});
 fireEvent.click(screen.getByRole('button',{name:'Load more photos'}));
 await waitFor(()=>expect(run).toHaveBeenCalledWith('suggestPhotos','drive',{offset:60,limit:30}));
 await waitFor(()=>expect(screen.getAllByRole('checkbox',{name:/Suggested photo,/})).toHaveLength(2));
 expect(screen.queryByRole('button',{name:'Load more photos'})).not.toBeInTheDocument();
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

it('keeps the mounted state through StrictMode so an imported photo is still reported',async()=>{
 const added={id:'photo-1',url:'data:image/jpeg;base64,one',caption:'First'};
 const updated={...trip,localPhotos:[added]};
 const onUpdated=vi.fn();
 const run=vi.fn(async method=>method==='pickPhotos'
  ?{trips:[updated],photoResults:{selected:1,added:1,duplicates:0,failed:[]}}
  :null);
 render(<StrictMode><ActivityDetail trip={trip} run={run} onUpdated={onUpdated}/></StrictMode>);
 fireEvent.click(screen.getByRole('button',{name:'Add photos'}));
 expect(await screen.findByText('1 photo added.')).toBeInTheDocument();
 expect(onUpdated).toHaveBeenCalledTimes(1);
});