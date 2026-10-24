import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import RecorderPanel from './RecorderPanel.jsx';
vi.mock('../lib/recorder.js',async importOriginal=>({...await importOriginal(),recorderAvailable:()=>true}));
vi.mock('./JourneyMap.jsx',()=>({default:()=> <div aria-label="Interactive journey route map"/>}));
afterEach(cleanup);
it('requires permissions and native storage before starting',()=>{
 const run=vi.fn();render(<RecorderPanel state={{active:null,permission:'denied',storageReady:true}} run={run} vehicles={[]}/>);
 expect(screen.getByRole('button',{name:'Start walking'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Open location settings'}));
 expect(run).toHaveBeenCalledWith('openSettings',false);
});
it('passes selected vehicle and activity to the native recorder',()=>{
 const run=vi.fn();render(<RecorderPanel state={{active:null,permission:'whenInUse',storageReady:true}} run={run} vehicles={[{id:'car',name:'Family car'}]}/>);
 fireEvent.click(screen.getByRole('button',{name:'Driving',exact:true}));
 fireEvent.change(screen.getByRole('combobox'),{target:{value:'Family car'}});
 fireEvent.click(screen.getByRole('button',{name:'Start driving'}));
 expect(run).toHaveBeenCalledWith('start','Driving','Family car');
});
it('routes pause to native state and requires finish confirmation',()=>{
 const run=vi.fn();render(<RecorderPanel state={{active:{activity:'Walking',source:'device',state:'recording',startedAt:1000,points:[],durationSeconds:20,distanceMeters:0},permission:'whenInUse'}} run={run} vehicles={[]}/>);
 expect(screen.getByText('Waiting for an accurate GPS fix')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Pause',exact:true}));
 expect(run).toHaveBeenCalledWith('transition','pause');
 fireEvent.click(screen.getByRole('button',{name:'Finish',exact:true}));
 expect(run).not.toHaveBeenCalledWith('transition','finish');
 expect(screen.getByRole('button',{name:'Save activity'})).toBeInTheDocument();
});
