import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const api=vi.hoisted(()=>({loadNotificationSettings:vi.fn(),saveNotificationSettings:vi.fn(),deleteMyEfforts:vi.fn()}));
vi.mock('../lib/segmentsApi.js',async original=>({...await original(),...api}));
vi.mock('../lib/supabase.js',()=>({supabase:null}));
import SegmentNotificationSettings from './SegmentNotificationSettings.jsx';
afterEach(cleanup);
beforeEach(()=>{for(const fn of Object.values(api))fn.mockReset();api.loadNotificationSettings.mockResolvedValue({segment_community:true,segment_personal:true,segment_participation:'anonymous'});});
const flush=()=>act(async()=>{await Promise.resolve();await Promise.resolve();});

it('loads and saves segment notification preferences, and restores the box when saving fails',async()=>{
 api.saveNotificationSettings.mockResolvedValueOnce().mockRejectedValueOnce(new Error('Notification settings were not saved.'));
 render(<SegmentNotificationSettings owner="me"/>);await flush();
 const community=screen.getByRole('checkbox',{name:/others complete or set a record/});
 expect(community).toBeChecked();
 fireEvent.click(community);await flush();
 expect(api.saveNotificationSettings).toHaveBeenCalledWith('me',{segment_community:false,segment_personal:true,segment_participation:'anonymous'});
 expect(community).not.toBeChecked();
 fireEvent.click(screen.getByRole('checkbox',{name:'My personal bests'}));await flush();
 expect(screen.getByRole('alert')).toHaveTextContent('Notification settings were not saved.');
 expect(screen.getByRole('checkbox',{name:'My personal bests'})).toBeChecked();
});

it('explains participation, is anonymous by default, and lets the person show their name or stop and remove efforts',async()=>{
 api.saveNotificationSettings.mockResolvedValue();api.deleteMyEfforts.mockResolvedValue(3);
 render(<SegmentNotificationSettings owner="me"/>);await flush();
 expect(screen.getByText(/only the time on that segment is sent: never your route or activity/)).toBeInTheDocument();
 expect(screen.getByRole('radio',{name:/Count my times anonymously/})).toBeChecked();
 expect(screen.getByRole('radio',{name:/Count my times anonymously/})).toHaveAccessibleName(/Nobody sees your name/);
 fireEvent.click(screen.getByRole('radio',{name:/Show my name/}));await flush();
 expect(api.saveNotificationSettings).toHaveBeenLastCalledWith('me',expect.objectContaining({segment_participation:'public'}));
 expect(screen.queryByRole('button',{name:'Remove my earlier efforts'})).toBeNull();
 fireEvent.click(screen.getByRole('radio',{name:/Don’t record my efforts/}));await flush();
 expect(api.saveNotificationSettings).toHaveBeenLastCalledWith('me',expect.objectContaining({segment_participation:'off'}));
 fireEvent.click(screen.getByRole('button',{name:'Remove my earlier efforts'}));await flush();
 expect(api.deleteMyEfforts).toHaveBeenCalled();
 expect(screen.getByRole('status')).toHaveTextContent('3 efforts removed.');
});
