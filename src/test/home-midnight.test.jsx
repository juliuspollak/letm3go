// Permanent regression coverage for the real-clock baseline failure at midnight.
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../App.jsx';
import { emptyRecorder } from '../lib/recorder.js';
const { recorder } = vi.hoisted(() => ({ recorder: vi.fn() }));
vi.mock('../lib/AuthContext.jsx', () => ({
 AuthProvider: ({children}) => children,
 useAuth: () => ({status:'authenticated',session:{user:{id:'owner'}},preferences:{vehicles:[],onboardingComplete:true},savePreferences:vi.fn()})
}));
vi.mock('../lib/config.js', () => ({config:{configured:false,appleEnabled:false,pushEnabled:false,teslaEnabled:false}}));
vi.mock('../lib/supabase.js', () => ({supabase:null}));
vi.mock('../lib/useRecorder.js', () => ({useRecorder:recorder}));
vi.mock('../lib/useMapLocation.js', () => ({useMapLocation:() => ({position:null,loading:false,error:'',locate:vi.fn()})}));
vi.mock('../components/JourneyMap.jsx', () => ({default:() => <div aria-label="Route map"/>}));
beforeEach(() => { vi.useFakeTimers({toFake:['Date']}); });
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); window.history.replaceState({},'','/'); });
it.each([
 {hour:12,minute:0,age:3600,expectedDistance:'5.9',expectedCount:1},
 {hour:0,minute:15,age:300,expectedDistance:'5.9',expectedCount:1},
 {hour:0,minute:15,age:3600,expectedDistance:'0',expectedCount:0},
])('uses the activity calendar day at $hour:$minute with age $age seconds', ({hour,minute,age,expectedDistance,expectedCount}) => {
 vi.setSystemTime(new Date(2026,10,2,hour,minute));
 const now=Date.now()/1000, startedAt=now-age;
 const trip={id:'clock-boundary',title:'Drive home',source:'device',activity:'Driving',state:'paused',recordingMode:'automatic',startedAt,endedAt:startedAt+180,durationSeconds:180,distanceMeters:5900,ownerID:'owner',points:[{latitude:-33,longitude:151,timestamp:startedAt,segment:0},{latitude:-32.9,longitude:151,timestamp:startedAt+180,segment:0}],details:{provisional:true}};
 recorder.mockReturnValue({state:{...emptyRecorder,ownerID:'owner',trips:[trip],automaticEnabled:true},run:vi.fn(),busy:false,error:''});
 render(<App/>);
 const summary=screen.getByRole('button',{name:'View activities for Today'});
 expect(summary).toBeInTheDocument();
 expect(summary).toHaveTextContent(expectedDistance);
 expect(summary).toHaveTextContent('km');
 expect(summary.querySelector('.home-daily-stat:nth-child(2) strong')).toHaveTextContent(String(expectedCount));
});
