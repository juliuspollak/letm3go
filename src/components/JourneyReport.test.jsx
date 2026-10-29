import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import JourneyReport from './JourneyReport.jsx';

const report={generatedAt:1761685000,startedAt:1761680098,endedAt:1761680800,activity:'Driving',recordedDistanceMeters:859,
 routeQuality:{fixCount:34,gapCount:1,largestGapSeconds:276,unobservedSeconds:276,unobservedMeters:494},trackingNotes:[],
 events:[{at:1761680464,kind:'lifecycle',message:'Recorder was not executing for 276s',context:{notExecutingSeconds:'276',wakeCause:'location'}}],current:{}};
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

it('copies the readable journey report to the clipboard',async()=>{
 const writeText=vi.fn().mockResolvedValue();vi.stubGlobal('navigator',{...navigator,clipboard:{writeText}});
 render(<JourneyReport report={report}/>);
 expect(screen.getByText(/iOS stopped running the app 1 time/,{selector:'li'})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:/Copy report/}));
 expect(await screen.findByRole('button',{name:/Copied to clipboard/})).toBeInTheDocument();
 expect(writeText.mock.calls[0][0]).toMatch(/^Letm3go journey diagnostics/);
});
it('falls back to the legacy copy command when the clipboard API is refused',async()=>{
 vi.stubGlobal('navigator',{...navigator,clipboard:{writeText:vi.fn().mockRejectedValue(new Error('denied'))}});
 document.execCommand=vi.fn().mockReturnValue(true);
 render(<JourneyReport report={report}/>);
 fireEvent.click(screen.getByRole('button',{name:/Copy report/}));
 expect(await screen.findByRole('button',{name:/Copied to clipboard/})).toBeInTheDocument();
 expect(document.execCommand).toHaveBeenCalledWith('copy');
});
it('tells the user how to copy manually when every copy method fails',async()=>{
 vi.stubGlobal('navigator',{...navigator,clipboard:{writeText:vi.fn().mockRejectedValue(new Error('denied'))}});
 document.execCommand=vi.fn().mockReturnValue(false);
 render(<JourneyReport report={report}/>);
 fireEvent.click(screen.getByRole('button',{name:/Copy report/}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Copy is unavailable');
});
it('shows a failed export as an error without a copy button',()=>{
 render(<JourneyReport report={{error:'This journey could not be exported on this build.'}}/>);
 expect(screen.getByRole('alert')).toHaveTextContent('could not be exported');
 expect(screen.queryByRole('button',{name:/Copy report/})).not.toBeInTheDocument();
});
