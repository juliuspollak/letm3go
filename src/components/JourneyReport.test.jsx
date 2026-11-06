import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const sent=vi.hoisted(()=>({send:vi.fn()}));
vi.mock('../lib/supabase.js',()=>({supabase:{}}));
vi.mock('../lib/AuthContext.jsx',()=>({useAuth:()=>({status:'authenticated'})}));
vi.mock('../lib/feedback.js',async original=>({...(await original()),sendReportAsFeedback:sent.send}));
import JourneyReport from './JourneyReport.jsx';

const report={generatedAt:1761685000,startedAt:1761680098,endedAt:1761680800,activity:'Driving',recordedDistanceMeters:859,
 routeQuality:{fixCount:34,gapCount:1,largestGapSeconds:276,unobservedSeconds:276,unobservedMeters:494},trackingNotes:[],
 events:[{at:1761680464,kind:'lifecycle',message:'Recorder was not executing for 276s',context:{notExecutingSeconds:'276',wakeCause:'location'}}],current:{}};
afterEach(()=>{cleanup();vi.unstubAllGlobals();sent.send.mockReset();});

it('sends the readable journey report as feedback and shows the number to quote',async()=>{
 sent.send.mockResolvedValue({id:'t',number:42,owner_id:'o'});
 render(<JourneyReport report={report}/>);
 expect(screen.getByText(/iOS stopped running the app 1 time/,{selector:'li'})).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:/Copy/})).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText(/What went wrong/),{target:{value:'Distance too short'}});
 fireEvent.click(screen.getByRole('button',{name:/as feedback/}));
 expect(await screen.findByRole('status')).toHaveTextContent('Sent as feedback #42');
 expect(sent.send.mock.calls[0][1]).toMatchObject({kind:'journey',note:'Distance too short',text:expect.stringMatching(/^Letm3go journey diagnostics/)});
});
it('keeps the note and offers the same send again when sending fails',async()=>{
 sent.send.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({id:'t',number:7});
 render(<JourneyReport report={report}/>);
 fireEvent.click(screen.getByRole('button',{name:/as feedback/}));
 expect(await screen.findByRole('alert')).toHaveTextContent('offline');
 fireEvent.click(screen.getByRole('button',{name:/as feedback/}));
 expect(await screen.findByRole('status')).toHaveTextContent('#7');
 // A retry reuses the same ticket token and report ID.
 expect(sent.send.mock.calls[1][1].token).toBe(sent.send.mock.calls[0][1].token);
 expect(sent.send.mock.calls[1][1].reportID).toBe(sent.send.mock.calls[0][1].reportID);
});
it('shows a failed export as an error without a copy button',()=>{
 render(<JourneyReport report={{error:'This journey could not be exported on this build.'}}/>);
 expect(screen.getByRole('alert')).toHaveTextContent('could not be exported');
 expect(screen.queryByRole('button',{name:/feedback/})).not.toBeInTheDocument();
});
