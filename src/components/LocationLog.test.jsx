import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({exportLocationDiagnostics:vi.fn()}));
vi.mock('../lib/recorder.js',()=>({recorder:mocks,recorderAvailable:()=>true}));
import LocationLog from './LocationLog.jsx';
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
it('copies a full report in one tap with no journeys, using the shared clipboard path',async()=>{
 const writeText=vi.fn().mockResolvedValue();vi.stubGlobal('navigator',{clipboard:{writeText}});
 mocks.exportLocationDiagnostics.mockResolvedValue({generatedAt:100,current:{placeType:'home',locationMode:'resting'},events:[],journeys:[]});
 render(<LocationLog/>);fireEvent.click(screen.getByRole('button',{name:'Copy Full Location Log'}));
 await waitFor(()=>expect(writeText).toHaveBeenCalledTimes(1));
 expect(writeText.mock.calls[0][0]).toContain('BEGIN LETM3GO FULL LOCATION LOG');expect(writeText.mock.calls[0][0]).toContain('END LETM3GO FULL LOCATION LOG');
 expect(await screen.findByRole('status')).toHaveTextContent('Copied part 1 of 1');
});
it('shows numbered chunks and selectable full text when the report is large',async()=>{
 const writeText=vi.fn().mockResolvedValue();vi.stubGlobal('navigator',{clipboard:{writeText}});
 mocks.exportLocationDiagnostics.mockResolvedValue({generatedAt:100,current:{},events:Array.from({length:1800},(_,i)=>({at:i+1,kind:'observations',message:'diagnostic summary',context:{reason:'history '.repeat(80)}})),journeys:[]});
 render(<LocationLog/>);fireEvent.click(screen.getByRole('button',{name:'Copy Full Location Log'}));
 await screen.findByRole('button',{name:/Copy part 2 of/});expect(writeText).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:/Copy part 2 of/}));await waitFor(()=>expect(writeText).toHaveBeenCalledTimes(1));
 expect(writeText.mock.calls[0][0]).toContain('PART 2/');expect(screen.getByLabelText('Full location log text').value).toBe(writeText.mock.calls[0][0]);
});
it('provides selectable complete text when both clipboard paths fail',async()=>{
 vi.stubGlobal('navigator',{clipboard:{writeText:vi.fn().mockRejectedValue(new Error('refused'))}});
 mocks.exportLocationDiagnostics.mockResolvedValue({generatedAt:100,current:{},events:[],journeys:[]});
 render(<LocationLog/>);fireEvent.click(screen.getByRole('button',{name:'Copy Full Location Log'}));
 expect(await screen.findByText(/Copy unavailable/)).toBeInTheDocument();expect(screen.getByLabelText('Full location log text').value).toContain('END LETM3GO');
});
