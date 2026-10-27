import {act,cleanup,fireEvent,render,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({embed:vi.fn(),unembed:vi.fn(),snapshot:vi.fn(),open:vi.fn(),close:vi.fn(),addListener:vi.fn()}));
vi.mock('../lib/appleMaps.js',()=>({appleMaps:mocks,appleMapsAvailable:()=>true}));
import AppleMap from './AppleMap.jsx';
const payload={routes:[[[1,2],[3,4],[5,6]]],pins:[]};
beforeEach(()=>{
 for(const name of ['embed','unembed','close'])mocks[name].mockResolvedValue({});
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
it('removes the native map while a web dialog covers it and restores it afterwards',async()=>{
 render(<AppleMap payload={payload}/>);
 await waitFor(()=>expect(mocks.embed).toHaveBeenCalled());
 const dialog=document.createElement('dialog');dialog.setAttribute('open','');
 await act(async()=>document.body.append(dialog));
 await waitFor(()=>expect(mocks.unembed).toHaveBeenCalled());
 mocks.embed.mockClear();await act(async()=>dialog.remove());
 await waitFor(()=>expect(mocks.embed).toHaveBeenCalled());
});
it('opens the same trimmed route in fullscreen that is shown in the embedded map',async()=>{
 const points=[{latitude:1,longitude:2,segment:0},{latitude:3,longitude:4,segment:0},{latitude:5,longitude:6,segment:0}];
 const {getByRole}=render(<AppleMap payload={payload} trimRange={{points,start:1,end:2}}/>);
 fireEvent.click(getByRole('button',{name:'Open interactive Apple journey map'}));
 await waitFor(()=>expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({routes:[[[3,4],[5,6]]]})));
});
