import { render,screen,fireEvent,cleanup } from '@testing-library/react';
import { afterEach,it,expect,vi } from 'vitest';
import TrackingPermissions from './TrackingPermissions.jsx';
afterEach(cleanup);
it('shows native service requests without pretending that permission means GPS is running',()=>{const run=vi.fn(),back=vi.fn();render(<TrackingPermissions recording={{state:{permission:'always',precise:true,automaticEnabled:true,automaticSampling:'lowPowerIdle',storageReady:true,motionTypes:['Stationary'],trackingServices:{continuousGPSRequested:false,significantChangesRequested:true,visitsRequested:true,registeredRegions:2},build:'25'},run}} onBack={back}/>);expect(screen.getByText('Stationary · Low-power standby')).toBeInTheDocument();expect(screen.getByText('Continuous GPS').nextSibling).toHaveTextContent('Off');expect(screen.getByText('Location access').nextSibling).toHaveTextContent('Always');expect(screen.getByRole('switch',{name:'Automatic Tracking'})).toHaveAttribute('aria-checked','true');fireEvent.click(screen.getByRole('switch'));expect(run).toHaveBeenCalledWith('setAutomatic',false);fireEvent.click(screen.getByRole('button',{name:'Settings'}));expect(back).toHaveBeenCalledOnce();});
it('preserves the explicit Always upgrade and shows active trips separately',()=>{const run=vi.fn();render(<TrackingPermissions recording={{state:{permission:'whenInUse',automaticEnabled:true,automaticTrip:{},storageReady:true},run}} onBack={vi.fn()}/>);expect(screen.getByText('Recording an automatic trip')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Allow Always location access'}));expect(run).toHaveBeenCalledWith('requestPermission',true);});

it('shows actual manager, indicator policy and GPS reason',()=>{
 render(<TrackingPermissions recording={{state:{permission:'always',trackingServices:{continuousGPSRequested:true},gpsReason:'Recording automatic journey',locationManagerID:'LocationRecorder.shared.manager',indicatorRequested:false,applicationState:'Foreground',oneShotLocationRequests:0},run:vi.fn()}} onBack={vi.fn()}/>);
 expect(screen.getByText('GPS reason').nextSibling).toHaveTextContent('Recording automatic journey');
 expect(screen.getByText('Recorder manager').nextSibling).toHaveTextContent('LocationRecorder.shared.manager');
 expect(screen.getByText('Prominent indicator requested').nextSibling).toHaveTextContent('No');
});
