import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
const api=vi.hoisted(()=>({loadNotificationSettings:vi.fn(),saveNotificationSettings:vi.fn()}));
vi.mock('../lib/segmentsApi.js',()=>api);
import SegmentNotificationSettings from './SegmentNotificationSettings.jsx';
afterEach(cleanup);
const flush=()=>act(async()=>{await Promise.resolve();await Promise.resolve();});

it('loads and saves segment notification preferences, and restores the box when saving fails',async()=>{
 api.loadNotificationSettings.mockResolvedValue({segment_community:true,segment_personal:true});
 api.saveNotificationSettings.mockResolvedValueOnce().mockRejectedValueOnce(new Error('Notification settings were not saved.'));
 render(<SegmentNotificationSettings owner="me"/>);await flush();
 const community=screen.getByRole('checkbox',{name:/others complete or set a record/});
 expect(community).toBeChecked();
 fireEvent.click(community);await flush();
 expect(api.saveNotificationSettings).toHaveBeenCalledWith('me',{segment_community:false,segment_personal:true});
 expect(community).not.toBeChecked();
 fireEvent.click(screen.getByRole('checkbox',{name:'My personal bests'}));await flush();
 expect(screen.getByRole('alert')).toHaveTextContent('Notification settings were not saved.');
 expect(screen.getByRole('checkbox',{name:'My personal bests'})).toBeChecked();
});
