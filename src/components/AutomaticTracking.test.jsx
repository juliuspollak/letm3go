import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import AutomaticTracking from './AutomaticTracking.jsx';
vi.mock('../lib/recorder.js',()=>({recorderAvailable:()=>true}));
afterEach(cleanup);
it('requires explicit enablement and does not equate missing permissions with active tracking',()=>{
 const run=vi.fn();const {rerender}=render(<AutomaticTracking state={{storageReady:true}} run={run}/>);
 expect(run).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Enable automatic history'}));
 expect(run).toHaveBeenCalledWith('setAutomatic',true);
 rerender(<AutomaticTracking state={{automaticEnabled:true,automaticAvailable:false,permission:'whenInUse',storageReady:true}} run={run}/>);
 expect(screen.getByText('Needs permission')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Allow Always location access'}));
 expect(run).toHaveBeenCalledWith('requestPermission',true);
});

it('shows ownership suppression without claiming permission is missing, and permits a paused manual activity',()=>{
 const run=vi.fn();
 const {rerender}=render(<AutomaticTracking state={{automaticEnabled:true,automaticAvailable:false,automaticSampling:'manual',permission:'always',storageReady:true}} run={run}/>);
 expect(screen.getByText('Paused for another recording')).toBeInTheDocument();
 expect(screen.queryByText('Needs permission')).not.toBeInTheDocument();
 rerender(<AutomaticTracking state={{automaticEnabled:true,automaticAvailable:true,automaticSampling:'locationStandby',active:{state:'paused'},permission:'always',storageReady:true}} run={run}/>);
 expect(screen.getByText('Detection: Departure standby')).toBeInTheDocument();
});
