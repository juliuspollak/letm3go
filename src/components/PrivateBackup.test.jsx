import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({receipts:{}}));
vi.mock('../lib/AuthContext.jsx',()=>({useAuth:()=>({status:'authenticated',session:{user:{id:'owner'}},preferences:{syncReceipts:mock.receipts},savePreferences:vi.fn()})}));
vi.mock('../lib/supabase.js',()=>({supabase:{}}));
vi.mock('../lib/config.js',()=>({config:{backupEnabled:true}}));
vi.mock('../lib/cloudRestore.js',()=>({restoreCloudJournal:vi.fn()}));
vi.mock('../lib/collectionSync.js',()=>({mergeRestoredCollection:vi.fn(),syncCollections:vi.fn()}));
vi.mock('../lib/settingsSync.js',()=>({mergeRestoredSettings:vi.fn(),syncAccountSettings:vi.fn()}));
import PrivateBackup from './PrivateBackup.jsx';
afterEach(cleanup);
const trip=id=>({id,title:'Drive',activity:'Driving',source:'device',startedAt:1,endedAt:2,points:[]});
// 30 recorded, 25 backed up, 5 waiting (one of them refused): the three numbers a person needs.
it('shows how many recorded activities are backed up, waiting, and why one was refused',()=>{
 const ids=Array.from({length:30},(_,i)=>`a${String(i).padStart(7,'0')}-0000-4000-8000-000000000000`);
 mock.receipts=Object.fromEntries(ids.slice(0,25).map(id=>[id,{owner:'owner',revision:1}]));
 mock.receipts[`backup-failure:${ids[27]}`]={owner:'owner',message:'Cloud activity conflict',attempts:2,nextAt:Date.now()+300000};
 render(<PrivateBackup state={{ownerID:'owner',trips:ids.map(trip)}}/>);
 const status=screen.getByText(/25 of 30 recorded activities are backed up/);
 expect(status.textContent).toContain('5 waiting');
 expect(status.textContent).toContain('a0000027 was refused: Cloud activity conflict (tried 2 times; next try in 5 min)');
});
it('says nothing when nothing has been recorded',()=>{
 mock.receipts={};
 render(<PrivateBackup state={{ownerID:'owner',trips:[]}}/>);
 expect(screen.queryByText(/recorded activities are backed up/)).toBeNull();
});
