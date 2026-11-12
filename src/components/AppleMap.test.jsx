import {act,cleanup,fireEvent,render,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({embed:vi.fn(),resize:vi.fn(),update:vi.fn(),unembed:vi.fn(),hide:vi.fn(),snapshot:vi.fn(),open:vi.fn(),close:vi.fn(),setOverlayInset:vi.fn(),addListener:vi.fn(),sendOverview:vi.fn(),forgetOverview:vi.fn()}));
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


it('keeps the map and its camera across background and resume without unembedding',async()=>{
 render(<AppleMap payload={payload}/>);
 await waitFor(()=>expect(mocks.embed).toHaveBeenCalled());
 await waitFor(()=>expect(mocks.update).toHaveBeenCalled());
 mocks.embed.mockClear();mocks.unembed.mockClear();
 Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});
 await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));});
 expect(mocks.unembed).not.toHaveBeenCalled();
 Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});
 await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));});
 expect(mocks.unembed).not.toHaveBeenCalled();
 expect(mocks.embed).not.toHaveBeenCalled();
});

it('opens fullscreen without destroying the embedded map camera',async()=>{
 const {getByRole}=render(<AppleMap payload={payload}/>);
 await waitFor(()=>expect(mocks.embed).toHaveBeenCalled());
 await waitFor(()=>expect(mocks.update).toHaveBeenCalled());
 mocks.unembed.mockClear();
 fireEvent.click(getByRole('button',{name:'Open interactive Apple journey map'}));
 await waitFor(()=>expect(mocks.open).toHaveBeenCalled());
 expect(mocks.unembed).not.toHaveBeenCalled();
});

it('updates and expires a speed bubble in place without rebuilding the map',async()=>{
 const people=label=>({routes:[],pins:[{id:'people:anna',kind:'people',point:[-33.87,151.21],title:'Anna',...(label?{label}:{}),members:[{id:'anna',name:'Anna',state:'live'}]}]});
 const {rerender}=render(<AppleMap payload={people('Driving · 68 km/h')}/>);
 await waitFor(()=>expect(mocks.update).toHaveBeenCalled());
 mocks.embed.mockClear();mocks.update.mockClear();mocks.snapshot.mockClear();
 rerender(<AppleMap payload={people('Driving · 72 km/h')}/>);
 await waitFor(()=>expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({pins:[expect.objectContaining({label:'Driving · 72 km/h'})]})));
 mocks.update.mockClear();
 rerender(<AppleMap payload={people(null)}/>);
 await waitFor(()=>expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({pins:[expect.not.objectContaining({label:expect.anything()})]})));
 expect(mocks.embed).not.toHaveBeenCalled();
 expect(mocks.snapshot).not.toHaveBeenCalled();
});

describe('a person\'s day map (dynamic)',()=>{
 const day=(over={})=>({routes:[[[1,2],[3,4]]],pins:[],gaps:[],estimated:[],live:[],fitKey:'her|2026-11-10',...over});
 it('updates in place for new points, a live trail, the slider and a new day; it never re-embeds or recreates the map',async()=>{
  const {rerender}=render(<AppleMap payload={day()} dynamic large viewportKey="her"/>);
  await waitFor(()=>expect(mocks.embed).toHaveBeenCalledTimes(1));
  await waitFor(()=>expect(mocks.update).toHaveBeenCalled());
  const mapID=mocks.embed.mock.calls[0][0].mapID;
  mocks.update.mockClear();
  // A live point, a scrub marker, then the next day (different lines, same viewportKey).
  rerender(<AppleMap payload={day({live:[[5,6],[5.1,6.1]]})} dynamic large viewportKey="her"/>);
  rerender(<AppleMap payload={day({pins:[{id:'playback',kind:'playback',point:[1,2]}]})} dynamic large viewportKey="her"/>);
  rerender(<AppleMap payload={day({routes:[[[7,8],[9,10]]],fitKey:'her|2026-11-09'})} dynamic large viewportKey="her"/>);
  await waitFor(()=>expect(mocks.update.mock.calls.length).toBeGreaterThanOrEqual(3));
  expect(mocks.embed).toHaveBeenCalledTimes(1);
  expect(mocks.unembed).not.toHaveBeenCalled();
  expect(mocks.update.mock.calls.every(call=>call[0].mapID===mapID)).toBe(true);
  expect(mocks.update.mock.calls.at(-1)[0].fitKey).toBe('her|2026-11-09');
 });
 it('Locate asks the camera to move through an update (a focus point and a new fit key), never a re-embed',async()=>{
  const {rerender}=render(<AppleMap payload={day()} dynamic large viewportKey="her"/>);
  await waitFor(()=>expect(mocks.embed).toHaveBeenCalledTimes(1));
  mocks.update.mockClear();
  rerender(<AppleMap payload={day({focus:[-34.9,151.1],fitKey:'her|2026-11-10|locate1'})} dynamic large viewportKey="her"/>);
  await waitFor(()=>expect(mocks.update).toHaveBeenCalled());
  expect(mocks.embed).toHaveBeenCalledTimes(1);expect(mocks.unembed).not.toHaveBeenCalled();
  expect(mocks.update.mock.calls.at(-1)[0]).toMatchObject({focus:[-34.9,151.1],fitKey:'her|2026-11-10|locate1'});
 });
 it('without dynamic, changed routes still re-embed (other maps are unchanged)',async()=>{
  const {rerender}=render(<AppleMap payload={day()} large viewportKey="a"/>);
  await waitFor(()=>expect(mocks.embed).toHaveBeenCalledTimes(1));
  rerender(<AppleMap payload={day({routes:[[[7,8],[9,10]]]})} large viewportKey="a"/>);
  await waitFor(()=>expect(mocks.embed.mock.calls.length).toBeGreaterThan(1));
 });
});

it('removes a dynamic map freeze immediately when its geometry is invalidated, including a late hide reply',async()=>{
 const {container,rerender}=render(<AppleMap payload={payload} dynamic/>);
 await waitFor(()=>expect(mocks.update).toHaveBeenCalled());
 let release;
 mocks.hide.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 const dialog=document.createElement('dialog');dialog.setAttribute('open','');document.body.appendChild(dialog);
 try{
  await waitFor(()=>expect(release).toBeTypeOf('function'));
  rerender(<AppleMap payload={{routes:[],pins:[]}} dynamic/>);
  await act(async()=>{release({image:'data:image/jpeg;base64,revoked'});});
  expect(container.querySelector('.apple-map-freeze')).toBeNull();
 }finally{dialog.remove();}
});

it('withholds an outdated snapshot while a replacement for revoked geometry is pending',async()=>{
 mocks.embed.mockImplementationOnce(()=>new Promise(()=>{}));
 const {container,rerender}=render(<AppleMap payload={payload} dynamic/>);
 await waitFor(()=>expect(container.querySelector('.apple-map-preview img')).not.toBeNull());
 mocks.snapshot.mockImplementationOnce(()=>new Promise(()=>{}));
 rerender(<AppleMap payload={{routes:[],pins:[]}} dynamic/>);
 expect(container.querySelector('.apple-map-preview img')).toBeNull();
});

describe('native map frame: it always matches the page\'s placeholder',()=>{
 const settle=async()=>{await waitFor(()=>expect(mocks.embed).toHaveBeenCalled());await waitFor(()=>expect(mocks.update).toHaveBeenCalled());mocks.embed.mockClear();mocks.update.mockClear();mocks.resize.mockClear();};
 const rect=()=>HTMLElement.prototype.getBoundingClientRect;
 it('sends document coordinates, so the native scroll offset is never added to an earlier measurement',async()=>{
  // Home was scrolled by 300; the map's placeholder is 100 below the top of the screen.
  setScroll(300);rect().mockReturnValue({...BOX,y:100,top:100,bottom:450});
  render(<AppleMap payload={payload}/>);
  await waitFor(()=>expect(mocks.embed).toHaveBeenCalled());
  expect(mocks.embed.mock.calls[0][0]).toMatchObject({pageX:10,pageY:400,width:700,height:350,layoutSeq:expect.any(Number)});
 });
 it('a page that clamps its scroll to the top after the tab change leaves the map exactly where it is',async()=>{
  setScroll(300);rect().mockReturnValue({...BOX,y:100,top:100,bottom:450});
  render(<AppleMap payload={payload}/>);
  await settle();
  // The page is now at the top (scroll clamped by the shorter Map page): same document position.
  setScroll(0);rect().mockReturnValue({...BOX,y:400,top:400,bottom:750});
  await act(async()=>{fireEvent.scroll(window);window.dispatchEvent(new Event('resize'));});
  expect(mocks.resize).not.toHaveBeenCalled();expect(mocks.embed).not.toHaveBeenCalled();
 });
 it('moves a same-sized placeholder that moved vertically, with a newer sequence number',async()=>{
  render(<AppleMap payload={payload}/>);
  await waitFor(()=>expect(mocks.embed).toHaveBeenCalled());
  const first=mocks.embed.mock.calls[0][0].layoutSeq;
  await settle();
  rect().mockReturnValue({...BOX,y:140,top:140,bottom:490});
  await act(async()=>{window.dispatchEvent(new Event('resize'));});
  await waitFor(()=>expect(mocks.resize).toHaveBeenCalledWith(expect.objectContaining({pageY:140,height:350})));
  expect(mocks.resize.mock.calls.at(-1)[0].layoutSeq).toBeGreaterThan(first);
  expect(mocks.embed).not.toHaveBeenCalled();
 });
 it('never extends past the top of the tab bar, with or without scrolling',async()=>{
  const nav=document.createElement('nav');nav.className='mobile-nav';document.body.append(nav);
  try{
   const original=rect();
   original.mockImplementation(function(){return this===nav?{...BOX,y:600,top:600,bottom:680,height:80}:{...BOX,y:300,top:300,bottom:800,height:500};});
   setScroll(120);
   render(<AppleMap payload={payload}/>);
   await waitFor(()=>expect(mocks.embed).toHaveBeenCalled());
   const request=mocks.embed.mock.calls[0][0];
   expect(request.height).toBe(292); // 600 - 300 - 8
   expect(request.pageY+request.height).toBeLessThanOrEqual(600+120);
  }finally{nav.remove();}
 });
 it('moves the map when only the tab bar changes (it sets where the map must stop)',async()=>{
  const nav=document.createElement('nav');nav.className='mobile-nav';document.body.append(nav);
  const observed=[];let notify=null;
  vi.stubGlobal('ResizeObserver',class{constructor(callback){notify=callback;}observe(element){observed.push(element);}disconnect(){}});
  try{
   let navTop=700;
   rect().mockImplementation(function(){return this===nav?{...BOX,y:navTop,top:navTop,bottom:navTop+80,height:80}:{...BOX,y:100,top:100,bottom:900,height:800};});
   render(<AppleMap payload={payload}/>);
   await settle();
   expect(observed).toContain(nav);
   expect(observed.some(element=>element.classList?.contains('apple-map-frame'))).toBe(true);
   navTop=640;
   await act(async()=>{notify([]);});
   await waitFor(()=>expect(mocks.resize).toHaveBeenCalledWith(expect.objectContaining({height:532}))); // 640 - 100 - 8
  }finally{nav.remove();}
 });
 it('follows an orientation change, a visual viewport change and the end of a transition',async()=>{
  render(<AppleMap payload={payload}/>);
  await settle();
  rect().mockReturnValue({...BOX,y:60,top:60,bottom:410});
  await act(async()=>{window.dispatchEvent(new Event('orientationchange'));});
  await waitFor(()=>expect(mocks.resize).toHaveBeenCalledWith(expect.objectContaining({pageY:60})));
  mocks.resize.mockClear();
  rect().mockReturnValue({...BOX,y:90,top:90,bottom:440});
  await act(async()=>{document.body.dispatchEvent(new Event('transitionend',{bubbles:true}));});
  await waitFor(()=>expect(mocks.resize).toHaveBeenCalledWith(expect.objectContaining({pageY:90})));
 });
 it('does not resend anything while nothing moved',async()=>{
  render(<AppleMap payload={payload}/>);
  await settle();
  await act(async()=>{window.dispatchEvent(new Event('resize'));window.dispatchEvent(new Event('orientationchange'));fireEvent.scroll(window);});
  await act(async()=>{await new Promise(r=>setTimeout(r,60));});
  expect(mocks.embed).not.toHaveBeenCalled();expect(mocks.resize).not.toHaveBeenCalled();expect(mocks.update).not.toHaveBeenCalled();
 });
 it('numbers requests in the order they were measured, even when an embed waits and a later one overtakes it',async()=>{
  let release;mocks.embed.mockImplementationOnce(()=>new Promise(resolve=>{release=()=>resolve({frame:{x:10,y:20,width:700,height:350}});}));
  render(<AppleMap payload={payload}/>);
  await waitFor(()=>expect(mocks.embed).toHaveBeenCalledTimes(1));
  // The layout moves while that embed is still pending.
  rect().mockReturnValue({...BOX,y:200,top:200,bottom:550});
  await act(async()=>{window.dispatchEvent(new Event('resize'));});
  await waitFor(()=>expect(mocks.embed.mock.calls.length+mocks.resize.mock.calls.length).toBeGreaterThanOrEqual(2));
  const requests=[...mocks.embed.mock.calls,...mocks.resize.mock.calls].map(call=>call[0]).sort((a,b)=>a.layoutSeq-b.layoutSeq);
  expect(new Set(requests.map(r=>r.layoutSeq)).size).toBe(requests.length);
  expect(requests.at(-1).pageY).toBe(200); // the newest number carries the newest measurement
  mocks.resize.mockClear();
  await act(async()=>{release();await Promise.resolve();});
  // The late answer is to a request the newer one replaced: it says nothing about the final place, so it
  // starts no further move (the newer request is checked on its own answer).
  await act(async()=>{await new Promise(r=>setTimeout(r,40));});
  expect(mocks.resize).not.toHaveBeenCalled();
 });
 it('moves the map when the native side reports a frame different from the page\'s, once if that changes nothing',async()=>{
  mocks.embed.mockResolvedValue({frame:{x:10,y:496,width:700,height:350}}); // 400 pt too low, as on the phone
  mocks.resize.mockResolvedValue({resized:true,frame:{x:10,y:496,width:700,height:350}}); // and moving it changes nothing
  render(<AppleMap payload={payload}/>);
  await waitFor(()=>expect(mocks.resize).toHaveBeenCalledWith(expect.objectContaining({pageY:20,layoutSeq:expect.any(Number)})));
  await act(async()=>{await new Promise(r=>setTimeout(r,80));});
  expect(mocks.resize.mock.calls.length).toBe(1); // a constant disagreement is not chased
 });
 it('keeps correcting while each move does change the reported frame, but never more than three times',async()=>{
  mocks.embed.mockResolvedValue({frame:{x:10,y:496,width:700,height:350}});
  let n=0;mocks.resize.mockImplementation(async()=>({resized:true,frame:{x:10,y:400-(++n)*50,width:700,height:350}}));
  render(<AppleMap payload={payload}/>);
  await waitFor(()=>expect(mocks.resize.mock.calls.length).toBe(3));
  await act(async()=>{await new Promise(r=>setTimeout(r,80));});
  expect(mocks.resize.mock.calls.length).toBe(3);
 });
 it('leaves the map alone when the native frame matches',async()=>{
  mocks.embed.mockResolvedValue({frame:{x:10,y:20,width:700,height:350}});
  render(<AppleMap payload={payload}/>);
  await waitFor(()=>expect(mocks.embed).toHaveBeenCalled());
  await act(async()=>{await new Promise(r=>setTimeout(r,60));});
  expect(mocks.resize).not.toHaveBeenCalled();
 });
 it('an older native layer that reports no frame is not second-guessed',async()=>{
  render(<AppleMap payload={payload}/>);
  await waitFor(()=>expect(mocks.embed).toHaveBeenCalled());
  await act(async()=>{await new Promise(r=>setTimeout(r,60));});
  expect(mocks.resize).not.toHaveBeenCalled();
 });
 it('keeps the one native map through all of it: no unembed, no second embed',async()=>{
  render(<AppleMap payload={payload}/>);
  await settle();
  for(const y of [40,80,20]){rect().mockReturnValue({...BOX,y,top:y,bottom:y+350});await act(async()=>{window.dispatchEvent(new Event('resize'));});}
  await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));});
  expect(mocks.embed).not.toHaveBeenCalled();expect(mocks.unembed).not.toHaveBeenCalled();
 });
});

describe('Home to Map and back, repeatedly',()=>{
 it('each visit embeds one map at the placeholder\'s document position and removes it on leaving, whatever the scroll was',async()=>{
  const rect=HTMLElement.prototype.getBoundingClientRect;
  for(const scroll of [0,420,0,180,0]){
   mocks.embed.mockClear();mocks.unembed.mockClear();
   setScroll(scroll);rect.mockReturnValue({...BOX,y:100,top:100,bottom:450});
   const view=render(<AppleMap payload={payload}/>);
   await waitFor(()=>expect(mocks.embed).toHaveBeenCalledTimes(1));
   expect(mocks.embed.mock.calls[0][0]).toMatchObject({pageY:100+scroll});
   view.unmount();
   await waitFor(()=>expect(mocks.unembed).toHaveBeenCalledTimes(1));
  }
 });
 it('an answer that arrives after the map has gone is ignored, not turned into more layout work',async()=>{
  let release;mocks.embed.mockImplementationOnce(()=>new Promise(resolve=>{release=()=>resolve({frame:{x:0,y:999,width:1,height:1}});}));
  const view=render(<AppleMap payload={payload}/>);
  await waitFor(()=>expect(mocks.embed).toHaveBeenCalledTimes(1));
  view.unmount();mocks.resize.mockClear();
  await act(async()=>{release();await Promise.resolve();});
  expect(mocks.resize).not.toHaveBeenCalled();
 });
});

it('updates styled person routes, selection and follow commands without re-embedding',async()=>{
 const base={routes:[],pins:[],personDay:true,scope:'her|today',camera:{key:'people:me',mode:'free',command:1},styled:[{points:[[1,2],[3,4]],activityID:'a',width:2.5}]};
 const {rerender}=render(<AppleMap payload={base} dynamic/>);
 await waitFor(()=>expect(mocks.embed).toHaveBeenCalledTimes(1));
 mocks.update.mockClear();
 rerender(<AppleMap payload={{...base,selectedActivity:'a',styled:[{...base.styled[0],width:4}],camera:{...base.camera,mode:'person',personId:'her',command:2}}} dynamic/>);
 await waitFor(()=>expect(mocks.update).toHaveBeenCalled());
 expect(mocks.embed).toHaveBeenCalledTimes(1);
 expect(mocks.unembed).not.toHaveBeenCalled();
});
it('updates numbered flags and handles their existing selection event without recreating the map',async()=>{
 const handlers={},onStep=vi.fn();
 mocks.addListener.mockImplementation(async(name,handler)=>{handlers[name]=handler;return {remove:vi.fn()};});
 const flag={id:'step:a',kind:'step',point:[1,2],label:'1',activityID:'a',selected:false};
 const base={routes:[],pins:[flag],personDay:true,scope:'her|today',styled:[]};
 const {rerender}=render(<AppleMap payload={base} dynamic onStep={onStep}/>);
 await waitFor(()=>expect(mocks.embed).toHaveBeenCalledTimes(1));
 const mapID=mocks.embed.mock.calls[0][0].mapID;
 await waitFor(()=>expect(handlers.stepSelected).toBeTypeOf('function'));
 act(()=>handlers.stepSelected({mapID:'other',activityID:'a'}));expect(onStep).not.toHaveBeenCalled();
 act(()=>handlers.stepSelected({mapID,activityID:'a'}));expect(onStep).toHaveBeenCalledWith('a');
 rerender(<AppleMap payload={{...base,pins:[{...flag,selected:true}]}} dynamic onStep={onStep}/>);
 await waitFor(()=>expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({pins:[{...flag,selected:true}]})));
 expect(mocks.embed).toHaveBeenCalledTimes(1);expect(mocks.unembed).not.toHaveBeenCalled();
});
it('shows the activity bubble inside the map fallback, with scoped Open and Close controls',async()=>{
 mocks.embed.mockResolvedValue({error:'not embedded'});
 const onControl=vi.fn(),activityPreview={activityID:'a',title:'Morning walk',detail:'Walking · 8:00 am · 20m · ~2 km recorded'};
 const {container}=render(<AppleMap payload={{routes:[],pins:[],activityPreview}} embeddedEnabled={false} onControl={onControl} dynamic/>);
 const bubble=within(container).getByRole('region',{name:'Selected activity'});
 expect(bubble.closest('.map-frame')).toBeTruthy();expect(bubble.textContent).toContain('Morning walk');
 fireEvent.click(within(bubble).getByRole('button',{name:'Open activity'}));expect(onControl).toHaveBeenCalledWith('pday:open:a');
 fireEvent.click(within(bubble).getByRole('button',{name:'Close activity preview'}));expect(onControl).toHaveBeenCalledWith('pday:clear:a');
});
it('updates a native activity bubble incrementally without re-embedding',async()=>{
 const base={routes:[],pins:[],personDay:true};
 const {rerender}=render(<AppleMap payload={base} dynamic/>);await waitFor(()=>expect(mocks.embed).toHaveBeenCalledTimes(1));
 rerender(<AppleMap payload={{...base,activityPreview:{activityID:'a',title:'Walk',detail:'Walking'}}} dynamic/>);
 await waitFor(()=>expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({activityPreview:expect.objectContaining({activityID:'a'})})));
 expect(mocks.embed).toHaveBeenCalledTimes(1);
});
it('reopens fullscreen once when returning to its saved map origin',async()=>{
 const onResumeFullscreen=vi.fn(),payload={routes:[],pins:[],personDay:true};
 const {rerender}=render(<AppleMap payload={payload} dynamic resumeFullscreen={7} onResumeFullscreen={onResumeFullscreen}/>);
 await waitFor(()=>expect(mocks.open).toHaveBeenCalledTimes(1));
 expect(onResumeFullscreen).toHaveBeenCalledTimes(1);
 rerender(<AppleMap payload={payload} dynamic resumeFullscreen={0} onResumeFullscreen={onResumeFullscreen}/>);
 expect(mocks.open).toHaveBeenCalledTimes(1);
});
it('forwards the scoped fullscreen Open action from the existing native map result',async()=>{
 const onControl=vi.fn();mocks.open.mockResolvedValue({mapAction:'pday:open-fullscreen:a'});
 render(<AppleMap payload={{routes:[],pins:[]}} embeddedEnabled={false} onControl={onControl}/>);
 fireEvent.click(within(document.body).getByRole('button',{name:'Open interactive Apple journey map'}));
 await waitFor(()=>expect(onControl).toHaveBeenCalledWith('pday:open-fullscreen:a'));
});
