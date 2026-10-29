import {act,cleanup,fireEvent,render,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({embed:vi.fn(),unembed:vi.fn(),hide:vi.fn(),snapshot:vi.fn(),open:vi.fn(),close:vi.fn(),addListener:vi.fn(),sendOverview:vi.fn(),forgetOverview:vi.fn()}));
vi.mock('../lib/appleMaps.js',()=>({appleMaps:mocks,appleMapsAvailable:()=>true,sendOverview:mocks.sendOverview,forgetOverview:mocks.forgetOverview}));
import AppleMap from './AppleMap.jsx';
const payload={routes:[[[1,2],[3,4],[5,6]]],pins:[]};
beforeEach(()=>{
 for(const name of ['embed','unembed','close','sendOverview'])mocks[name].mockResolvedValue({});
 mocks.hide.mockResolvedValue({image:'data:image/jpeg;base64,frozen'});
 mocks.snapshot.mockResolvedValue({image:'data:image/jpeg;base64,test'});
 mocks.open.mockResolvedValue({});mocks.addListener.mockResolvedValue({remove:vi.fn()});
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({x:10,y:20,top:20,bottom:370,left:10,right:710,width:700,height:350});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('embeds an interactive map and follows scroll events inside the detail scroll container',async()=>{
 const {container}=render(<div data-testid="scroll"><AppleMap payload={payload}/></div>);
 await waitFor(()=>expect(mocks.embed).toHaveBeenCalled());
 mocks.embed.mockClear();
 fireEvent.scroll(container.firstChild);
 await waitFor(()=>expect(mocks.embed).toHaveBeenCalledWith(expect.objectContaining({preserveViewport:true})));
 expect(container.querySelector('.apple-map-open')).toBeNull();
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
  mocks.embed.mockClear();
  rerender(<AppleMap payload={people(['self'])}/>);
  await waitFor(()=>expect(mocks.embed).toHaveBeenCalled());
  expect(mocks.embed.mock.calls.at(-1)[0].pins.map(pin=>pin.id)).toEqual(['people:self']);
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
