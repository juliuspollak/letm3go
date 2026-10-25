import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import Garage from './Garage.jsx';
const tesla=vi.hoisted(()=>({request:vi.fn(),open:vi.fn(),recording:vi.fn().mockResolvedValue({active:false,label:'Setup required'})}));
vi.mock('../lib/tesla.js',()=>({teslaRequest:tesla.request,openTeslaURL:tesla.open,teslaRecordingRequest:tesla.recording,openTeslaPairingURL:vi.fn()}));
beforeEach(()=>{vi.clearAllMocks();tesla.request.mockReset();tesla.request.mockResolvedValue({connectionReady:false,connected:false});});
afterEach(cleanup);
async function manage(){await screen.findByRole('button',{name:'Manage Tesla'});fireEvent.click(screen.getByRole('button',{name:'Manage Tesla'}));}
const manual={id:'car',name:'Family car',make:'Kia',model:'EV6',source:'manual'};
it('opens with compact vehicle rows and no detail form or Tesla selection controls',async()=>{
 render(<Garage vehicles={[manual]} onSave={vi.fn()}/>);
 expect(screen.getByRole('button',{name:'View Family car'})).toHaveTextContent('Kia EV6 · Manual');
 expect(screen.queryByLabelText('Vehicle name')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Choose Tesla vehicles'})).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Add vehicle manually'})).toBeInTheDocument();
 await screen.findByText('Not connected');
});
it('shows a clean empty state and opens a separate manual add flow',async()=>{
 const onSave=vi.fn().mockResolvedValue();render(<Garage vehicles={[]} onSave={onSave}/>);
 expect(screen.getByText('No vehicles yet')).toBeInTheDocument();expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Add vehicle manually'}));
 fireEvent.change(screen.getByLabelText('Vehicle name'),{target:{value:'My bike'}});fireEvent.change(screen.getByLabelText('Category'),{target:{value:'bicycle'}});
 fireEvent.click(screen.getByRole('button',{name:'Add vehicle',exact:true}));
 await waitFor(()=>expect(onSave).toHaveBeenCalledWith([expect.objectContaining({name:'My bike',category:'bicycle',source:'manual'})]));
 expect(await screen.findByRole('heading',{name:'Vehicles',exact:true})).toBeInTheDocument();expect(screen.queryByLabelText('Vehicle name')).not.toBeInTheDocument();
});
it('edits and archives only after opening vehicle details, preserving import metadata',async()=>{
 const onSave=vi.fn().mockResolvedValue(),v={...manual,source:'tesla',teslaVehicleID:'provider-car'};
 const {rerender}=render(<Garage vehicles={[v]} onSave={onSave}/>);
 fireEvent.click(screen.getByRole('button',{name:'View Family car'}));fireEvent.change(screen.getByLabelText('Vehicle name'),{target:{value:'My Kia'}});fireEvent.click(screen.getByRole('button',{name:'Save vehicle'}));
 await waitFor(()=>expect(onSave).toHaveBeenCalledWith([expect.objectContaining({id:'car',name:'My Kia',category:'car',source:'tesla',teslaVehicleID:'provider-car'})]));
 await screen.findByRole('heading',{name:'Vehicles',exact:true});rerender(<Garage vehicles={[v]} onSave={onSave}/>);fireEvent.click(screen.getByRole('button',{name:'View Family car'}));fireEvent.click(screen.getByRole('button',{name:'Archive Family car'}));await waitFor(()=>expect(onSave).toHaveBeenLastCalledWith([expect.objectContaining({archived:true})]));
});
it('keeps failed removals in detail view and never reports success',async()=>{
 const onSave=vi.fn().mockRejectedValue(new Error('Full'));render(<Garage vehicles={[manual]} onSave={onSave}/>);
 fireEvent.click(screen.getByRole('button',{name:'View Family car'}));fireEvent.click(screen.getByRole('button',{name:'Remove Family car'}));expect(onSave).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Confirm removal'}));expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved');expect(screen.getByLabelText('Vehicle name')).toHaveValue('Family car');
});
it('keeps connection setup errors in management while manual creation remains available',async()=>{
 render(<Garage vehicles={[]} onSave={vi.fn()}/>);await screen.findByText('Not connected');fireEvent.click(screen.getByRole('button',{name:'Connect Tesla'}));
 fireEvent.click(screen.getByRole('button',{name:'Connect Tesla'}));expect(await screen.findByRole('alert')).toHaveTextContent('server setup');expect(tesla.open).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Garage',exact:true}));expect(screen.getByRole('button',{name:'Add vehicle manually'})).toBeEnabled();
});
it('opens genuine OAuth with optional location consent only after readiness',async()=>{
 tesla.request.mockImplementation(async action=>action==='status'?{connectionReady:true,connected:false}:{url:'https://auth.tesla.com/oauth2/v3/authorize?state=test'});
 render(<Garage vehicles={[]} onSave={vi.fn()}/>);await screen.findByText('Not connected');fireEvent.click(screen.getByRole('button',{name:'Connect Tesla'}));fireEvent.click(screen.getByRole('checkbox',{name:/Request vehicle-location/}));fireEvent.click(screen.getByRole('button',{name:'Connect Tesla'}));
 await waitFor(()=>expect(tesla.request).toHaveBeenCalledWith('authorize',{locationConsent:true}));expect(tesla.open).toHaveBeenCalledWith('https://auth.tesla.com/oauth2/v3/authorize?state=test');
});
it('gives a connected account with no vehicles a clear next step and truthful location status',async()=>{
 tesla.request.mockResolvedValue({connected:true,connectionReady:true});render(<Garage vehicles={[]} onSave={vi.fn()}/>);
 expect(await screen.findByText('Connected. Choose Tesla vehicles to add them to Garage.')).toBeInTheDocument();expect(screen.getByText(/0 vehicles imported/)).toHaveTextContent('Not verified');await manage();expect(screen.getByRole('button',{name:'Choose Tesla vehicles'})).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Connect Tesla'})).not.toBeInTheDocument();
});
it('selects multiple vehicles and can import more later without reconnecting or duplicating rows',async()=>{
 const onSave=vi.fn().mockResolvedValue();tesla.request.mockImplementation(async action=>action==='status'?{connected:true,locationAccess:true}:action==='vehicles'?{vehicles:[{teslaID:'t1',name:'Model Y'},{teslaID:'t2',name:'Model 3'}]}:{vehicles:[{id:'one',name:'Model Y',make:'Tesla',model:'Y',tesla_vehicle_id:'t1'},{id:'two',name:'Model 3',make:'Tesla',model:'3',tesla_vehicle_id:'t2'}]});
 const existing={id:'one',name:'Our renamed Y',make:'Tesla',model:'Y',source:'tesla',category:'car'};
 const {rerender}=render(<Garage vehicles={[existing]} onSave={onSave}/>);await manage();expect(screen.getByText('Location access').nextSibling).toHaveTextContent('Enabled');fireEvent.click(screen.getByRole('button',{name:'Import more Tesla vehicles'}));
 await screen.findByRole('heading',{name:'Choose Tesla vehicles'});const boxes=screen.getAllByRole('checkbox');fireEvent.click(boxes[0]);fireEvent.click(boxes[1]);
 fireEvent.click(screen.getByRole('button',{name:'Add selected vehicles (2)'}));await waitFor(()=>expect(onSave).toHaveBeenCalledWith([expect.objectContaining({id:'one',name:'Our renamed Y',source:'tesla'}),expect.objectContaining({id:'two',source:'tesla',teslaVehicleID:'t2'})]));
 const updated=onSave.mock.calls[0][0];rerender(<Garage vehicles={updated} onSave={onSave}/>);await screen.findByText('Selected vehicles added to Garage.');fireEvent.click(screen.getByRole('button',{name:'Garage',exact:true}));expect(screen.getByRole('button',{name:'View Our renamed Y'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'View Model 3'})).toBeInTheDocument();expect(tesla.request.mock.calls.some(([action])=>action==='authorize')).toBe(false);
});
it('allows one or many Tesla selections and preserves the picker on a failed local save',async()=>{
 const onSave=vi.fn().mockRejectedValue(new Error('Full'));
 tesla.request.mockImplementation(async action=>action==='status'?{connected:true}:action==='vehicles'?{vehicles:[{teslaID:'t1',name:'One'},{teslaID:'t2',name:'Two'}]}:{vehicles:[{id:'one',name:'One',make:'Tesla'},{id:'two',name:'Two',make:'Tesla'}]});
 render(<Garage vehicles={[]} onSave={onSave}/>);await manage();fireEvent.click(screen.getByRole('button',{name:'Choose Tesla vehicles'}));await screen.findByRole('heading',{name:'Choose Tesla vehicles'});for(const box of screen.getAllByRole('checkbox'))fireEvent.click(box);fireEvent.click(screen.getByRole('button',{name:'Add selected vehicles (2)'}));
 await waitFor(()=>expect(tesla.request).toHaveBeenCalledWith('selectVehicles',{ids:['t1','t2']}));expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved');expect(screen.getByRole('heading',{name:'Choose Tesla vehicles'})).toBeInTheDocument();expect(screen.queryByText('Selected vehicles added to Garage.')).not.toBeInTheDocument();
});
it('requires explicit revocation confirmation and keeps imported vehicles after disconnect',async()=>{
 const onSave=vi.fn();tesla.request.mockImplementation(async action=>action==='status'?{connected:true}:action==='revokeConsent'?{url:'https://auth.tesla.com/user/revoke/consent?x=test'}:{});
 render(<Garage vehicles={[{...manual,source:'tesla'}]} onSave={onSave}/>);await manage();fireEvent.click(screen.getByRole('button',{name:'Disconnect Tesla'}));expect(screen.getByRole('button',{name:'Confirm disconnect'})).toBeDisabled();fireEvent.click(screen.getByRole('checkbox',{name:/I revoked/}));fireEvent.click(screen.getByRole('button',{name:'Confirm disconnect'}));expect(await screen.findByRole('status')).toHaveTextContent('Saved vehicles and journeys are unchanged');expect(tesla.request).toHaveBeenCalledWith('disconnect',{consentRevoked:true});expect(onSave).not.toHaveBeenCalled();
});
it('does not infer a Tesla import or granted location scope from the vehicle make',async()=>{
 tesla.request.mockResolvedValue({connected:true,grantedScopes:['openid']});render(<Garage vehicles={[{...manual,make:'Tesla',source:'manual'}]} onSave={vi.fn()}/>);
 await screen.findByText('Connected. Choose Tesla vehicles to add them to Garage.');expect(screen.getByRole('button',{name:'View Family car'})).toHaveTextContent('Manual');expect(screen.getByText(/0 vehicles imported/)).toHaveTextContent('Not enabled');
});
it('imports one additional vehicle while already imported Tesla IDs are clearly unavailable to reselect',async()=>{
 const onSave=vi.fn().mockResolvedValue();
 const imported={id:'one',name:'Saved Tesla',make:'Tesla',model:'Y',source:'tesla',teslaVehicleID:'t1'};
 tesla.request.mockImplementation(async action=>action==='status'?{connected:true}:action==='vehicles'?{vehicles:[{teslaID:'t1',name:'One'},{teslaID:'t2',name:'Two'}]}:{vehicles:[{id:'two',name:'Two',make:'Tesla',model:'',tesla_vehicle_id:'t2'}]});
 render(<Garage vehicles={[imported]} onSave={onSave}/>);await manage();fireEvent.click(screen.getByRole('button',{name:'Import more Tesla vehicles'}));await screen.findByRole('heading',{name:'Choose Tesla vehicles'});
 expect(screen.getAllByRole('checkbox')[0]).toBeDisabled();expect(screen.getByText('Already in Garage')).toBeInTheDocument();fireEvent.click(screen.getAllByRole('checkbox')[1]);fireEvent.click(screen.getByRole('button',{name:'Add selected vehicles (1)'}));
 await waitFor(()=>expect(onSave).toHaveBeenCalledWith([imported,expect.objectContaining({id:'two',source:'tesla',teslaVehicleID:'t2'})]));expect(tesla.request).toHaveBeenCalledWith('selectVehicles',{ids:['t2']});
});
