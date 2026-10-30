import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({shareDiagnosticLog:vi.fn()}));
vi.mock('../lib/recorder.js',()=>({recorder:mocks,recorderAvailable:()=>true}));
import LocationLog from './LocationLog.jsx';
const writeText=vi.fn();
beforeEach(()=>{mocks.shareDiagnosticLog.mockReset();writeText.mockReset();vi.stubGlobal('navigator',{clipboard:{writeText}});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('offers exactly one export and hands it to the native share sheet',async()=>{
 mocks.shareDiagnosticLog.mockResolvedValue({shared:true,events:6000});
 render(<LocationLog/>);
 expect(screen.getAllByRole('button').map(button=>button.textContent)).toEqual(['Share Diagnostic Log']);
 fireEvent.click(screen.getByRole('button',{name:'Share Diagnostic Log'}));
 expect(await screen.findByRole('status')).toHaveTextContent('6000 events');
 expect(mocks.shareDiagnosticLog).toHaveBeenCalledTimes(1);expect(writeText).not.toHaveBeenCalled();
 expect(screen.queryByRole('textbox')).not.toBeInTheDocument();expect(screen.queryByText(/part/i)).not.toBeInTheDocument();
});
it('treats closing the share sheet as neither success nor failure',async()=>{
 mocks.shareDiagnosticLog.mockResolvedValue({shared:false,events:12});
 render(<LocationLog/>);fireEvent.click(screen.getByRole('button',{name:'Share Diagnostic Log'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Share Diagnostic Log'})).toBeEnabled());
 expect(screen.queryByRole('status')).not.toBeInTheDocument();expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('shows the failure with Retry and never falls back to another export',async()=>{
 mocks.shareDiagnosticLog.mockRejectedValueOnce(new Error('The diagnostic log could not be created. Nothing was exported.')).mockResolvedValueOnce({shared:true,events:3});
 render(<LocationLog/>);fireEvent.click(screen.getByRole('button',{name:'Share Diagnostic Log'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('could not be created');
 expect(writeText).not.toHaveBeenCalled();expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Retry'}));
 expect(await screen.findByRole('status')).toHaveTextContent('3 events');
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();expect(mocks.shareDiagnosticLog).toHaveBeenCalledTimes(2);
});
