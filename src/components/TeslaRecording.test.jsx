import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {it,expect,vi,beforeEach,afterEach} from 'vitest';
const mocks=vi.hoisted(()=>({request:vi.fn(),open:vi.fn()}));
vi.mock('../lib/tesla.js',()=>({teslaRecordingRequest:mocks.request,openTeslaPairingURL:mocks.open}));
import TeslaRecording from './TeslaRecording.jsx';
beforeEach(()=>{vi.clearAllMocks();mocks.request.mockResolvedValue({active:false,label:'Setup required',setting:null});});afterEach(cleanup);
it('shows setup required until actual receiver/configuration/data are verified and requires recording consent',async()=>{
 render(<TeslaRecording vehicle={{id:'car'}}/>);await screen.findByText('Setup required');expect(screen.getByRole('button',{name:'Enable automatic recording'})).toBeDisabled();fireEvent.click(screen.getByRole('checkbox',{name:/Record future/}));fireEvent.click(screen.getByRole('button',{name:'Enable automatic recording'}));await waitFor(()=>expect(mocks.request).toHaveBeenCalledWith('enable',{vehicleID:'car',consent:true}));
});
it('opens only a server-provided pairing link through the strict native URL helper',async()=>{
 mocks.request.mockImplementation(async action=>action==='pairingLink'?{url:'https://tesla.com/_ak/letm3go.au?vin=5YJ3E1EA0KF000001'}:{label:'Setup required'});render(<TeslaRecording vehicle={{id:'car'}}/>);fireEvent.click(screen.getByRole('button',{name:'Pair Letm3go key'}));await waitFor(()=>expect(mocks.open).toHaveBeenCalledWith('https://tesla.com/_ak/letm3go.au?vin=5YJ3E1EA0KF000001'));
});
it('distinguishes a legacy streaming toggle from virtual-key pairing and surfaces receiver outages',async()=>{
 mocks.request.mockResolvedValue({label:'Connection problem · receiver unavailable',setting:{keyRequired:false,enabled:true,configSynced:true,lastReceived:null}});render(<TeslaRecording vehicle={{id:'car'}}/>);await screen.findByText('Use vehicle Safety streaming toggle');expect(screen.queryByRole('button',{name:'Pair Letm3go key'})).not.toBeInTheDocument();expect(screen.getByText(/receiver unavailable/)).toBeInTheDocument();
});
