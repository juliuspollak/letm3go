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
 const run=vi.fn();render(<RecorderPanel state={{active:null,permission:'whenInUse',storageReady:true}} run={run} vehicles={[{id:'car',name:'Family car',category:'car'}]}/>);
 fireEvent.click(screen.getByRole('button',{name:'Driving',exact:true}));
 fireEvent.change(screen.getByRole('combobox'),{target:{value:'car'}});
 fireEvent.click(screen.getByRole('button',{name:'Start driving'}));
 expect(run).toHaveBeenCalledWith('start','Driving','Family car','car');
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
it('groups cycling styles under Cycling and passes the precise subtype to native recording',()=>{const run=vi.fn();render(<RecorderPanel state={{active:null,permission:'always',storageReady:true}} run={run} vehicles={[]}/>);expect(screen.queryByRole('button',{name:'Road'})).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Cycling',exact:true}));fireEvent.click(screen.getByRole('button',{name:'Mountain biking'}));expect(screen.getByRole('button',{name:'Cycling',exact:true})).toHaveAttribute('aria-pressed','true');fireEvent.click(screen.getByRole('button',{name:'Start mountain biking'}));expect(run).toHaveBeenLastCalledWith('start','MTB','',undefined);fireEvent.click(screen.getByRole('button',{name:'Road',exact:true}));fireEvent.click(screen.getByRole('button',{name:'Start road cycling'}));expect(run).toHaveBeenLastCalledWith('start','Road cycling','',undefined);});
it('lets the driver finish an automatic journey that has not confirmed arrival',()=>{
 const run=vi.fn().mockResolvedValue({trips:[]});
 render(<RecorderPanel state={{active:null,automaticTrip:{activity:'Driving',source:'device',state:'recording',startedAt:1000,points:[],durationSeconds:600,distanceMeters:5000},permission:'always',storageReady:true}} run={run} vehicles={[]}/>);
 expect(screen.getByText('Driving · detected automatically')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Finish automatic journey'}));
 expect(run).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Save journey'}));
 expect(run).toHaveBeenCalledWith('transition','finish');
});
it('explains that a stopped journey continues when movement resumes nearby',()=>{
 const run=vi.fn();
 render(<RecorderPanel state={{active:null,automaticState:'settled',automaticTrip:{activity:'Walking',source:'device',state:'paused',startedAt:1000,points:[],durationSeconds:900,distanceMeters:1200},permission:'always',storageReady:true}} run={run} vehicles={[]}/>);
 expect(screen.getByText('Walking · detected automatically')).toBeInTheDocument();
 expect(screen.getByText(/move again near here and the same activity continues/)).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Finish automatic journey'})).toBeInTheDocument();
});
it('shows a stopped journey that is already saved in History',()=>{
 const run=vi.fn().mockResolvedValue({trips:[]});
 render(<RecorderPanel state={{active:null,automaticState:'settled',trips:[{id:'stopped',activity:'Driving',source:'device',state:'paused',startedAt:1000,endedAt:1600,distanceMeters:5000,durationSeconds:600,details:{provisional:true,continuationEndsAt:2800}}],permission:'always',storageReady:true}} run={run} vehicles={[]}/>);
 expect(screen.getByText('Driving · detected automatically')).toBeInTheDocument();
 expect(screen.getByText(/saved to History/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Finish automatic journey'}));
 fireEvent.click(screen.getByRole('button',{name:'Save journey'}));
 expect(run).toHaveBeenCalledWith('transition','finish');
});
it('hides the automatic journey panel once a manual activity is active',()=>{
 const run=vi.fn();
 render(<RecorderPanel state={{active:{activity:'Walking',source:'device',state:'recording',startedAt:1000,points:[],durationSeconds:20,distanceMeters:0},automaticTrip:{activity:'Driving',state:'recording',points:[],durationSeconds:600,distanceMeters:5000},permission:'whenInUse'}} run={run} vehicles={[]}/>);
 expect(screen.queryByRole('button',{name:'Finish automatic journey'})).not.toBeInTheDocument();
});
it('does not carry a pending automatic finish into the manual activity panel',()=>{
 const run=vi.fn().mockResolvedValue({trips:[]});
 const {rerender}=render(<RecorderPanel state={{active:null,automaticTrip:{activity:'Driving',source:'device',state:'recording',startedAt:1000,points:[],durationSeconds:600,distanceMeters:5000},permission:'always',storageReady:true}} run={run} vehicles={[]}/>);
 fireEvent.click(screen.getByRole('button',{name:'Finish automatic journey'}));
 expect(screen.getByRole('button',{name:'Save journey'})).toBeInTheDocument();
 rerender(<RecorderPanel state={{active:{activity:'Walking',source:'device',state:'recording',startedAt:1000,points:[],durationSeconds:20,distanceMeters:0},permission:'always',storageReady:true}} run={run} vehicles={[]}/>);
 expect(screen.getByRole('button',{name:'Finish'})).toBeInTheDocument();
 expect(screen.queryByText('Finish and save this activity on your iPhone?')).not.toBeInTheDocument();
});



it('lets the rider select their own e-bike or regular bicycle without showing cars',()=>{
 const run=vi.fn();
 render(<RecorderPanel state={{active:null,permission:'always',storageReady:true}} run={run} vehicles={[{id:'1',name:'Road bike',category:'bicycle'},{id:'2',name:'E-MTB',category:'ebike'},{id:'3',name:'Family Tesla',category:'car'}]}/>);
 fireEvent.click(screen.getByRole('button',{name:'Cycling',exact:true}));
 const selector=screen.getByRole('combobox');
 expect(screen.getByRole('option',{name:'Road bike'})).toBeInTheDocument();
 expect(screen.getByRole('option',{name:'E-MTB'})).toBeInTheDocument();
 expect(screen.queryByRole('option',{name:'Family Tesla'})).not.toBeInTheDocument();
 fireEvent.change(selector,{target:{value:'2'}});
 fireEvent.click(screen.getByRole('button',{name:'Start cycling'}));
 expect(run).toHaveBeenCalledWith('start','Cycling','E-MTB','2');
});
