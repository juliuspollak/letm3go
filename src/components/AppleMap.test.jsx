import {act,cleanup,fireEvent,render,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({embed:vi.fn(),resize:vi.fn(),update:vi.fn(),unembed:vi.fn(),hide:vi.fn(),snapshot:vi.fn(),open:vi.fn(),close:vi.fn(),addListener:vi.fn(),sendOverview:vi.fn(),forgetOverview:vi.fn()}));
vi.mock('../lib/appleMaps.js',()=>({appleMaps:mocks,appleMapsAvailable:()=>true,sendOverview:mocks.sendOverview,forgetOverview:mocks.forgetOverview}));
import AppleMap from './AppleMap.jsx';
const payload={routes:[[[1,2],[3,4],[5,6]]],pins:[]};
const BOX={x:10,y:20,top:20,bottom:370,left:10,right:710,width:700,height:350};
function setScroll(y){Object.defineProperty(window,'scrollY',{value:y,configurable:true,writable:true});}
beforeEach(()=>{
 for(const name of ['embed','resize','update','unembed','close','sendOverview'])mocks[name].mockResolvedValue({});
 mocks.hide.mockResolvedValue({image:'data:image/jpeg;base64,frozen'});
 mocks.snapshot.mockResolvedValue({image:'data:image/jpeg;base64,test'});
 mocks.open.mockResolvedValue({});mocks.addListener.mockResolvedValue({remove:vi.fn()});
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({...BOX});
 setScroll(0);
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();setScroll(0);});
it('keeps one map through a page scroll and moves it in place when the sheet resizes',async()=>{
 const rect=HTMLElement.prototype.getBoundingClientRect;
 const {container}=render(<div data-testid="scroll"><AppleMap payload={payload}/></div>);
 await waitFor(()=>expect(mocks.embed).toHaveBeenCalled());
 const mapID=mocks.embed.mock.calls.at(-1)[0].mapID;
 // Wait for the embed to settle (one update follows a successful embed), then
 // count only what the scroll and the resize add from here on.
 await waitFor(()=>expect(mocks.update).toHaveBeenCalled());
 mocks.embed.mockClear();mocks.update.mockClear();mocks.resize.mockClear();
 // The page scrolls by 200px: the native map is a subview of the WebView's scroll
 // view, so it moves on its own. Re-embedding here would re-fit the camera and
 // repaint every overlay for nothing.
 setScroll(200);
 rect.mockReturnValue({...BOX,y:-180,top:-180,bottom:170});
 await act(async()=>{fireEvent.scroll(window);});
 expect(mocks.embed).not.toHaveBeenCalled();
 expect(mocks.resize).not.toHaveBeenCalled();
 // The details sheet grows, so the map's frame shrinks. Same map, new frame.
 setScroll(0);
 rect.mockReturnValue({...BOX,bottom:250,height:230});
 await act(async()=>{fireEvent.scroll(window);});
 await waitFor(()=>expect(mocks.resize).toHaveBeenCalledWith(expect.objectContaining({mapID,x:10,y:20,width:700,height:230})));
 expect(mocks.embed).not.toHaveBeenCalled();
 expect(mocks.update).not.toHaveBeenCalled();
 expect(container.querySelector('.apple-map-open')).toBeNull();
});
it('re-embeds instead of resizing when the native side has no such map',async()=>{
 const rect=HTMLElement.prototype.getBoundingClientRect;
 mocks.resize.mockResolvedValueOnce({missing:true});
 render(<AppleMap payload={payload}/>);
 await waitFor(()=>expect(mocks.embed).toHaveBeenCalled());
 mocks.embed.mockClear();
 rect.mockReturnValue({...BOX,bottom:250,height:230});
 await act(async()=>{fireEvent.scroll(window);});
 await waitFor(()=>expect(mocks.embed).toHaveBeenCalledWith(expect.objectContaining({mapID:expect.any(String),height:230})));
});
it('moves an existing person in place without re-embedding or taking a new snapshot',async()=>{
 const people=(lng)=>({routes:[],pins:[{id:'people:self',kind:'people',point:[-33.87,lng],title:'You',members:[{id:'self',name:'You',state:'live'}],fit:true}],camera:{key:'people:owner',mode:'all',personId:null,command:2,includeRoutes:false}});
 const {rerender}=render(<AppleMap payload={people(151.21)}/>);
 await waitFor(()=>expect(mocks.embed).toHaveBeenCalled());
 await waitFor(()=>expect(mocks.update).toHaveBeenCalled());
 mocks.embed.mockClear();mocks.update.mockClear();mocks.snapshot.mockClear();
 rerender(<AppleMap payload={people(151.22)}/>);
 await waitFor(()=>expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({pins:[expect.objectContaining({point:[-33.87,151.22]})]})));
 expect(mocks.embed).not.toHaveBeenCalled();
 expect(mocks.snapshot).not.toHaveBeenCalled();
});
it('hides the native map behind a still image while a web dialog covers it, then shows the same map again',async()=>{
 const {container}=render(<AppleMap payload={payload}/>);
 await waitFor(()=>expect(mocks.embed).toHaveBeenCalled());
 const dialog=document.createElement('dialog');dialog.setAttribute('open','');
 await act(async()=>document.body.append(dialog));
 await waitFor(()=>expect(mocks.hide).toHaveBeenCalledWith(expect.objectContaining({hidden:true})));
 // Hidden, never removed: its camera, layers and selection survive.
 expect(mocks.unembed).not.toHaveBeenCalled();
 await waitFor(()=>expect(container.querySelector('.apple-map-freeze')).toHaveAttribute('src','data:image/jpeg;base64,frozen'));
 mocks.embed.mockClear();await act(async()=>dialog.remove());
 await waitFor(()=>expect(mocks.hide).toHaveBeenCalledWith(expect.objectContaining({hidden:false})));
 await waitFor(()=>expect(mocks.embed).toHaveBeenCalled());
 await waitFor(()=>expect(container.querySelector('.apple-map-freeze')).toBeNull());
});
it('opens the same trimmed route in fullscreen that is shown in the embedded map',async()=>{
 const points=[{latitude:1,longitude:2,segment:0},{latitude:3,longitude:4,segment:0},{latitude:5,longitude:6,segment:0}];
 const {getByRole}=render(<AppleMap payload={payload} trimRange={{points,start:1,end:2}}/>);
 fireEvent.click(getByRole('button',{name:'Open interactive Apple journey map'}));
 await waitFor(()=>expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({routes:[[[3,4],[5,6]]]})));
});
it('fits the first positions arriving after an empty startup and then preserves user navigation',async()=>{
 const {rerender}=render(<AppleMap payload={{routes:[],pins:[]}}/>);
 await waitFor(()=>expect(mocks.embed).toHaveBeenCalled());
 mocks.embed.mockClear();
 rerender(<AppleMap payload={{routes:[],pins:[{point:[-34,151],kind:'location'}],focus:[-34,151]}}/>);
 await waitFor(()=>expect(mocks.embed).toHaveBeenCalledWith(expect.objectContaining({preserveViewport:false,focus:[-34,151]})));
 mocks.embed.mockClear();
 rerender(<AppleMap payload={{routes:[],pins:[{point:[-34.001,151],kind:'location'}],focus:[-34.001,151]}}/>);
 await waitFor(()=>expect(mocks.embed).toHaveBeenCalledWith(expect.objectContaining({preserveViewport:true})));
});
it('refits the viewport when an explicit map filter or locate action changes',async()=>{
 const {rerender}=render(<AppleMap payload={payload} viewportKey="people:0"/>);
 await waitFor(()=>expect(mocks.embed).toHaveBeenCalled());
 mocks.embed.mockClear();
 rerender(<AppleMap payload={payload} viewportKey="all:0"/>);
 await waitFor(()=>expect(mocks.embed).toHaveBeenCalledWith(expect.objectContaining({preserveViewport:false})));
});

describe('people map camera',()=>{
 const people=(ids)=>({routes:[],pins:ids.map((id,i)=>({id:`people:${id}`,kind:'people',point:[-33.87+i*0.01,151.21],members:[{id,name:id}],fit:true})),camera:{key:'people:owner',mode:'all',personId:null,command:2,includeRoutes:false}});
 let handlers;
 beforeEach(()=>{handlers={};mocks.addListener.mockImplementation((event,callback)=>{handlers[event]=callback;return Promise.resolve({remove:vi.fn()});});});
 it('sends the camera intent with the people and reports native mode changes for this map only',async()=>{
  const onCamera=vi.fn();
  render(<AppleMap payload={people(['self','anna','sam'])} onCamera={onCamera}/>);
  await waitFor(()=>expect(mocks.embed).toHaveBeenCalledWith(expect.objectContaining({camera:expect.objectContaining({mode:'all',command:2}),pins:expect.arrayContaining([expect.objectContaining({id:'people:anna'})])})));
  const mapID=mocks.embed.mock.calls[0][0].mapID;
  await waitFor(()=>expect(handlers.cameraChanged).toBeDefined());
  handlers.cameraChanged({mapID:'another-map',mode:'free',command:2});
  expect(onCamera).not.toHaveBeenCalled();
  handlers.cameraChanged({mapID,mode:'free',command:2});
  expect(onCamera).toHaveBeenCalledWith({mapID,mode:'free',command:2});
 });
 it('removes a person from the native map as soon as their sharing is revoked',async()=>{
  const {rerender}=render(<AppleMap payload={people(['self','anna'])}/>);
  await waitFor(()=>expect(mocks.embed).toHaveBeenCalled());
  await waitFor(()=>expect(mocks.update).toHaveBeenCalled());
  mocks.embed.mockClear();mocks.update.mockClear();
  rerender(<AppleMap payload={people(['self'])}/>);
  // A pin change is incremental content, not a new map: the live instance keeps
  // its camera and the revoked person disappears from the next update.
  await waitFor(()=>expect(mocks.update).toHaveBeenCalled());
  expect(mocks.update.mock.calls.at(-1)[0].pins.map(pin=>pin.id)).toEqual(['people:self']);
  expect(mocks.embed).not.toHaveBeenCalled();
 });
 it('releases the native map on tab change and re-embeds the same camera on return',async()=>{
  const {unmount}=render(<AppleMap payload={people(['self','anna'])}/>);
  await waitFor(()=>expect(mocks.embed).toHaveBeenCalled());
  const first=mocks.embed.mock.calls[0][0];
  unmount();
  expect(mocks.unembed).toHaveBeenCalledWith({mapID:first.mapID});
  mocks.embed.mockClear();
  render(<AppleMap payload={people(['self','anna'])}/>);
  await waitFor(()=>expect(mocks.embed).toHaveBeenCalled());
  expect(mocks.embed.mock.calls[0][0].camera).toEqual(first.camera);
 });
 it('does not listen for camera changes on route maps',async()=>{
  render(<AppleMap payload={payload}/>);
  await waitFor(()=>expect(mocks.embed).toHaveBeenCalled());
  expect(handlers.cameraChanged).toBeUndefined();
 });
});

it('releases a map whose embed was sent but not yet resolved when it unmounts',async()=>{
 let release;
 mocks.embed.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 const {unmount}=render(<AppleMap payload={payload}/>);
 await waitFor(()=>expect(mocks.embed).toHaveBeenCalled());
 const mapID=mocks.embed.mock.calls[0][0].mapID;
 unmount();
 expect(mocks.unembed).toHaveBeenCalledWith({mapID});
 await waitFor(()=>expect(mocks.close).toHaveBeenCalledWith({mapID}));
 expect(mocks.unembed.mock.invocationCallOrder[0]).toBeLessThan(mocks.close.mock.invocationCallOrder[0]);
 await act(async()=>release({}));
});
it('only closes a map that was never embedded',()=>{
 const {unmount}=render(<AppleMap payload={payload} picker/>);
 unmount();
 expect(mocks.unembed).not.toHaveBeenCalled();
 expect(mocks.close).toHaveBeenCalledWith({mapID:expect.any(String)});
});

describe('overview transfer',()=>{
 const overview={key:'d1',levels:[],photos:[],routes:{}};
 const overviewPayload={routes:[],pins:[],gaps:[],overview:'d1'};
 it('never names an overview the native map did not receive, and offers a retry',async()=>{
  mocks.sendOverview.mockRejectedValueOnce(new Error('bridge'));
  const {findByRole}=render(<AppleMap payload={overviewPayload} overview={overview}/>);
  await waitFor(()=>expect(mocks.embed).toHaveBeenCalled());
  expect(mocks.embed.mock.calls[0][0]).not.toHaveProperty('overview');
  const alert=await findByRole('alert');
  expect(alert).toHaveTextContent('Routes could not be drawn');
  mocks.embed.mockClear();
  fireEvent.click(within(alert).getByRole('button',{name:'Retry'}));
  await waitFor(()=>expect(mocks.embed).toHaveBeenCalledWith(expect.objectContaining({overview:'d1'})));
  expect(mocks.forgetOverview).toHaveBeenCalledWith('d1');
 });
 it('resends an overview the native side no longer has, once, then reports it',async()=>{
  mocks.embed.mockResolvedValue({missingOverview:true});
  const {findByRole}=render(<AppleMap payload={overviewPayload} overview={overview}/>);
  await waitFor(()=>expect(mocks.sendOverview.mock.calls.length).toBeGreaterThanOrEqual(2));
  expect(mocks.forgetOverview).toHaveBeenCalledWith('d1');
  expect(await findByRole('alert')).toHaveTextContent('Routes could not be drawn');
 });
 it('drops an embed whose overview was superseded while it was being sent',async()=>{
  let release;
  mocks.sendOverview.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
  const {rerender}=render(<AppleMap payload={overviewPayload} overview={overview}/>);
  await waitFor(()=>expect(mocks.sendOverview).toHaveBeenCalled());
  rerender(<AppleMap payload={{...overviewPayload,overview:'d2'}} overview={{...overview,key:'d2'}}/>);
  await waitFor(()=>expect(mocks.embed).toHaveBeenCalledWith(expect.objectContaining({overview:'d2'})));
  await act(async()=>release());
  await act(async()=>{});
  expect(mocks.embed.mock.calls.every(([request])=>request.overview==='d2')).toBe(true);
 });
 it('hides the map when a sheet opened while its first embed was still in flight',async()=>{
  let release;
  mocks.embed.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
  render(<AppleMap payload={payload}/>);
  await waitFor(()=>expect(mocks.embed).toHaveBeenCalled());
  const dialog=document.createElement('dialog');dialog.setAttribute('open','');
  await act(async()=>document.body.append(dialog));
  expect(mocks.hide).not.toHaveBeenCalled();
  await act(async()=>release({}));
  await waitFor(()=>expect(mocks.hide).toHaveBeenCalledWith(expect.objectContaining({hidden:true})));
  dialog.remove();
 });
});

it('updates inline native filters on the same live map without hiding or releasing it',async()=>{
 const handlers={};mocks.addListener.mockImplementation((name,callback)=>{handlers[name]=callback;return Promise.resolve({remove:vi.fn()});});
 const onControl=vi.fn();
 const props={payload,onControl,viewportKey:0};
 const closed={active:0,style:'standard',layers:{id:'panel:layers'},panel:null};
 const {rerender,container}=render(<AppleMap {...props} controls={closed}/>);
 await waitFor(()=>expect(mocks.embed).toHaveBeenCalled());
 const mapID=mocks.embed.mock.calls.at(-1)[0].mapID;
 mocks.embed.mockClear();mocks.hide.mockClear();mocks.unembed.mockClear();
 rerender(<AppleMap {...props} controls={{...closed,panel:{id:'filters',sections:[]}}}/>);
 await waitFor(()=>expect(mocks.embed).toHaveBeenCalledWith(expect.objectContaining({mapID,preserveViewport:true,mapStyle:'standard',layers:expect.objectContaining({controls:expect.objectContaining({panel:expect.objectContaining({id:'filters'})})})})));
 handlers.layersTapped({mapID,action:'day:2026-10-29'});expect(onControl).toHaveBeenCalledWith('day:2026-10-29');
 handlers.layersTapped({mapID:'other',action:'people'});expect(onControl).toHaveBeenCalledTimes(1);
 handlers.layersTapped({mapID});expect(onControl).toHaveBeenCalledTimes(1);
 expect(mocks.hide).not.toHaveBeenCalled();expect(mocks.unembed).not.toHaveBeenCalled();expect(container.querySelector('.apple-map-freeze')).toBeNull();
});

it('renders the location action natively and routes it to the current position request',async()=>{
 const handlers={};mocks.addListener.mockImplementation((name,callback)=>{handlers[name]=callback;return Promise.resolve({remove:vi.fn()});});
 const onLocate=vi.fn();
 const {container}=render(<AppleMap payload={payload} onLocate={onLocate}/>);
 await waitFor(()=>expect(mocks.embed).toHaveBeenCalledWith(expect.objectContaining({locate:true})));
 const mapID=mocks.embed.mock.calls.at(-1)[0].mapID;
 await waitFor(()=>expect(handlers.layersTapped).toBeDefined());
 handlers.layersTapped({mapID:'other',action:'locate'});expect(onLocate).not.toHaveBeenCalled();
 handlers.layersTapped({mapID,action:'locate'});expect(onLocate).toHaveBeenCalledTimes(1);
 await waitFor(()=>expect(container.querySelector('.map-locate-button')).toBeNull());
});

it('adds a photo through incremental update without re-embedding while preserving people-revocation behaviour',async()=>{
 const {rerender}=render(<AppleMap payload={payload}/>);
 await waitFor(()=>expect(mocks.embed).toHaveBeenCalled());
 await waitFor(()=>expect(mocks.update).toHaveBeenCalled());
 mocks.embed.mockClear();mocks.update.mockClear();
 rerender(<AppleMap payload={{...payload,pins:[{kind:'photo',point:[1,2],journeyID:'ride',photoID:'new-photo',selected:true}]}}/>);
 await waitFor(()=>expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({pins:[expect.objectContaining({photoID:'new-photo',selected:true})]})));
 expect(mocks.embed).not.toHaveBeenCalled();
});

it('tears down an embed that resolves after unmount without leaking the native map',async()=>{
 let release;
 mocks.embed.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 const {unmount}=render(<AppleMap payload={payload}/>);
 await waitFor(()=>expect(mocks.embed).toHaveBeenCalled());
 const mapID=mocks.embed.mock.calls.at(-1)[0].mapID;
 unmount();
 expect(mocks.unembed).toHaveBeenCalledWith(expect.objectContaining({mapID}));
 // Resolving the late embed afterwards must not resurrect the native map.
 await act(async()=>release({}));
 expect(mocks.unembed).toHaveBeenCalledTimes(1);
});

it('shows a single live map: the snapshot preview is removed once the native map is embedded',async()=>{
 const {container}=render(<AppleMap payload={payload}/>);
 // The fallback snapshot appears before the native map is ready.
 await waitFor(()=>expect(container.querySelector('img[alt="Apple map preview"]')).not.toBeNull());
 await waitFor(()=>expect(mocks.embed).toHaveBeenCalled());
 await waitFor(()=>expect(container.querySelector('.apple-map-preview.native-embedded')).not.toBeNull());
 // Once the native map owns the frame, the HTML snapshot must not linger under it.
 expect(container.querySelector('img[alt="Apple map preview"]')).toBeNull();
});
