import {beforeEach,it,expect,vi} from 'vitest';
const mock=vi.hoisted(()=>({readPhoto:vi.fn()}));
vi.mock('@capacitor/core',()=>({registerPlugin:()=>mock}));
import {resolvePhoto,setPrivateMediaOwner,forgetActivityPhotos} from './privateMedia.js';
const src='private-photo:owner/ride/photo';
beforeEach(()=>{setPrivateMediaOwner(null);setPrivateMediaOwner('owner');mock.readPhoto.mockReset();});
it('evicts cached deleted activity photos and prevents later reads',async()=>{
 mock.readPhoto.mockResolvedValue({url:'data:image/jpeg;base64,synthetic'});
 await resolvePhoto(src);await resolvePhoto(src);expect(mock.readPhoto).toHaveBeenCalledTimes(1);
 forgetActivityPhotos(['ride']);
 await expect(resolvePhoto(src)).rejects.toThrow('no longer available');expect(mock.readPhoto).toHaveBeenCalledTimes(1);
});
it('rejects an outstanding read after deletion instead of returning deleted media',async()=>{
 let finish;mock.readPhoto.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const pending=resolvePhoto(src);forgetActivityPhotos(['ride']);finish({url:'data:image/jpeg;base64,synthetic'});
 await expect(pending).rejects.toThrow('no longer available');
});
it('rejects a prior login read even after returning to the same account',async()=>{
 let finish;mock.readPhoto.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const pending=resolvePhoto(src);setPrivateMediaOwner('other');setPrivateMediaOwner('owner');finish({url:'data:image/jpeg;base64,synthetic'});
 await expect(pending).rejects.toThrow('Account changed');
});

it('does not apply another account deletion to this account cache',async()=>{
 mock.readPhoto.mockResolvedValue({url:'data:image/jpeg;base64,synthetic'});
 await resolvePhoto(src);forgetActivityPhotos(['ride'],'other');await resolvePhoto(src);
 expect(mock.readPhoto).toHaveBeenCalledTimes(1);
});
