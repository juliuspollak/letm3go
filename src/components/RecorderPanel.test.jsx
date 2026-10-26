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
it('groups cycling styles under Cycling and passes the precise subtype to native recording',()=>{const run=vi.fn();render(<RecorderPanel state={{active:null,permission:'always',storageReady:true}} run={run} vehicles={[]}/>);expect(screen.queryByRole('button',{name:'Road'})).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Cycling',exact:true}));fireEvent.click(screen.getByRole('button',{name:'Mountain biking'}));expect(screen.getByRole('button',{name:'Cycling',exact:true})).toHaveAttribute('aria-pressed','true');fireEvent.click(screen.getByRole('button',{name:'Start mountain biking'}));expect(run).toHaveBeenLastCalledWith('start','MTB','');fireEvent.click(screen.getByRole('button',{name:'Road',exact:true}));fireEvent.click(screen.getByRole('button',{name:'Start road cycling'}));expect(run).toHaveBeenLastCalledWith('start','Road cycling','');});

it('lets the rider select their own e-bike or regular bicycle without showing cars',()=>{
 const run=vi.fn();
 render(<RecorderPanel state={{active:null,permission:'always',storageReady:true}} run={run} vehicles={[{id:'1',name:'Road bike',category:'bicycle'},{id:'2',name:'E-MTB',category:'ebike'},{id:'3',name:'Family Tesla',category:'car'}]}/>);
 fireEvent.click(screen.getByRole('button',{name:'Cycling',exact:true}));
 const selector=screen.getByRole('combobox');
 expect(screen.getByRole('option',{name:'Road bike'})).toBeInTheDocument();
 expect(screen.getByRole('option',{name:'E-MTB'})).toBeInTheDocument();
 expect(screen.queryByRole('option',{name:'Family Tesla'})).not.toBeInTheDocument();
 fireEvent.change(selector,{target:{value:'E-MTB'}});
 fireEvent.click(screen.getByRole('button',{name:'Start cycling'}));
 expect(run).toHaveBeenCalledWith('start','Cycling','E-MTB');
});
