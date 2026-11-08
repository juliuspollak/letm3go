import {beforeEach,it,expect,vi} from 'vitest';
const mock=vi.hoisted(()=>({readPhoto:vi.fn(),invoke:vi.fn()}));
vi.mock('@capacitor/core',()=>({registerPlugin:()=>mock}));
vi.mock('./supabase.js',()=>({supabase:{functions:{invoke:mock.invoke}}}));
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

it('resolves cloud photos through the owner endpoint and refuses a late account response',async()=>{
 let finish;mock.invoke.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const pending=resolvePhoto('cloud-photo:owner/ride/photo');
 expect(mock.invoke).toHaveBeenCalledWith('journeys',{body:{action:'download',id:'ride',mediaID:'photo'}});
 setPrivateMediaOwner('other');finish({data:{url:'https://private.invalid/signed'},error:null});
 await expect(pending).rejects.toThrow('Account changed');
 await expect(resolvePhoto('cloud-photo:owner/ride/photo')).rejects.toThrow('locked account');
});
