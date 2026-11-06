import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const sent=vi.hoisted(()=>({send:vi.fn()}));
vi.mock('../lib/supabase.js',()=>({supabase:{}}));
vi.mock('../lib/AuthContext.jsx',()=>({useAuth:()=>({status:'authenticated'})}));
vi.mock('../lib/feedback.js',async original=>({...(await original()),sendReportAsFeedback:sent.send}));
import TrackingReport from './TrackingReport.jsx';
const run=vi.fn();
const report={start:100,end:200,oldestAvailableAt:90,events:[{at:90,kind:'lifecycle',message:'Started',context:{}},{at:130,kind:'observations',message:'Summary',context:{gpsDelivered:'3','rejected.accuracy':'2'}}]};
beforeEach(()=>{run.mockReset();run.mockResolvedValue(report);});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
const recording=()=>({state:{recorderDiagnostics:{events:10}},run});
it('creates an incident report even when there is no recorded activity',async()=>{
 render(<TrackingReport recording={recording()}/>);
 fireEvent.change(screen.getByLabelText('Expected activity'),{target:{value:'Walking'}});
 fireEvent.click(screen.getByRole('button',{name:'Prepare missed activity report'}));
 await waitFor(()=>expect(run).toHaveBeenCalledWith('trackingReport',expect.objectContaining({expectedActivity:'Walking',markMissing:true,start:expect.any(Number),end:expect.any(Number)})));
 expect(await screen.findByText('2 GPS fixes were rejected outside route accuracy limits.')).toBeInTheDocument();
 sent.send.mockResolvedValue({id:'t',number:9});
 fireEvent.click(screen.getByRole('button',{name:/as feedback/}));
 expect(await screen.findByText(/Sent as feedback/)).toHaveTextContent('#9');
 expect(sent.send.mock.calls[0][1]).toMatchObject({kind:'tracking',text:expect.stringContaining('rejected.accuracy')});
});
it('offers no copy: the report goes only to feedback',async()=>{
 render(<TrackingReport recording={recording()}/>);
 fireEvent.click(screen.getByRole('button',{name:'Prepare missed activity report'}));
 expect(await screen.findByRole('button',{name:/as feedback/})).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:/Copy/})).not.toBeInTheDocument();
 expect(screen.queryByLabelText('Tracking report text')).not.toBeInTheDocument();
});
it('rejects inverted incident times without calling the native recorder',async()=>{
 render(<TrackingReport recording={recording()}/>);
 fireEvent.change(screen.getByLabelText('Activity started'),{target:{value:'2026-01-02T10:00'}});
 fireEvent.change(screen.getByLabelText('Activity ended'),{target:{value:'2026-01-01T10:00'}});
 fireEvent.click(screen.getByRole('button',{name:'Prepare missed activity report'}));
 expect(await screen.findByRole('status')).toHaveTextContent('Choose a start before the end');
 expect(run).not.toHaveBeenCalled();
});
it('does not offer an unsupported plugin call on an older installed app',()=>{
 render(<TrackingReport recording={{state:{},run}}/>);
 expect(screen.getByRole('button',{name:'Prepare missed activity report'})).toBeDisabled();
 expect(screen.getByRole('status')).toHaveTextContent('updated iPhone app');
});
