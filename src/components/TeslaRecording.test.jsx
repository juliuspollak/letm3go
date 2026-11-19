import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {it,expect,vi,beforeEach,afterEach} from 'vitest';
const mocks=vi.hoisted(()=>({request:vi.fn(),open:vi.fn()}));
vi.mock('../lib/tesla.js',()=>({teslaRecordingRequest:mocks.request,openTeslaPairingURL:mocks.open}));
import TeslaRecording from './TeslaRecording.jsx';
beforeEach(()=>{vi.resetAllMocks();});afterEach(cleanup);

it('distinguishes an imported vehicle and a connected account from unavailable recording infrastructure',async()=>{
 mocks.request.mockRejectedValue(new Error('The recording backend is not deployed.'));
 render(<TeslaRecording vehicle={{id:'car'}} accountStatus={{connected:true}}/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('backend is not deployed');
 expect(screen.getByText('Imported to My Collection')).toBeInTheDocument();
 expect(screen.getByText('Connected')).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Enable automatic recording'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Pair Letm3go key'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Check vehicle setup'})).not.toBeInTheDocument();
});

it('requires explicit consent and shows pending configuration after it is submitted',async()=>{
 const setup={active:false,label:'Setup required',actions:{enable:true,check:true}};
 const pending={active:false,code:'configuration_pending',label:'Setup pending',actions:{check:true,disable:true}};
 mocks.request.mockResolvedValueOnce(setup).mockResolvedValueOnce({configured:true}).mockResolvedValueOnce(pending);
 render(<TeslaRecording vehicle={{id:'car'}}/>);
 await screen.findByText('Setup required');
 expect(screen.getByRole('button',{name:'Enable automatic recording'})).toBeDisabled();
 fireEvent.click(screen.getByRole('checkbox',{name:/Record future/}));
 fireEvent.click(screen.getByRole('button',{name:'Enable automatic recording'}));
 await screen.findByText('Setup pending');
 expect(mocks.request).toHaveBeenCalledWith('enable',{vehicleID:'car',consent:true});
 expect(screen.queryByRole('button',{name:'Enable automatic recording'})).not.toBeInTheDocument();
 expect(mocks.request.mock.calls.filter(([action])=>action==='status')).toHaveLength(2);
});

it('opens pairing only after the backend has verified that the key is required',async()=>{
 const pairing={label:'Pair the Letm3go virtual key',actions:{pair:true},setting:{keyRequired:true,keyPaired:false}};
 const url='https://tesla.com/_ak/letm3go.au?vin=5YJ3E1EA0KF000001';
 mocks.request.mockResolvedValueOnce(pairing).mockResolvedValueOnce({url}).mockResolvedValueOnce(pairing);
 render(<TeslaRecording vehicle={{id:'car'}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Pair Letm3go key'}));
 await waitFor(()=>expect(mocks.open).toHaveBeenCalledWith(url));
});

it('lets an owner stop accepting data even during a receiver outage and retry remote removal',async()=>{
 mocks.request.mockResolvedValueOnce({label:'Connection problem · receiver unavailable',actions:{disable:true},setting:{keyRequired:false,enabled:true,configSynced:true}});
 mocks.request.mockRejectedValueOnce(new Error('Vehicle streaming removal is pending.'));
 mocks.request.mockResolvedValueOnce({code:'removal_pending',label:'Vehicle streaming removal pending',actions:{disable:true}});
 render(<TeslaRecording vehicle={{id:'car'}}/>);
 await screen.findByText('Use vehicle Safety streaming toggle');
 expect(screen.queryByRole('button',{name:'Pair Letm3go key'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Disable automatic recording'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('removal is pending');
 expect(await screen.findByRole('button',{name:'Retry removing vehicle streaming'})).toBeInTheDocument();
});
