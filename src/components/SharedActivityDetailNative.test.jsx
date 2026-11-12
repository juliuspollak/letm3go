import {render,cleanup} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({owner:null}));
vi.mock('@capacitor/core',async original=>{const actual=await original();return {...actual,Capacitor:{...actual.Capacitor,getPlatform:()=>'ios',isNativePlatform:()=>true}};});
vi.mock('../lib/supabase.js',()=>({supabase:null}));
vi.mock('../lib/useSharedActivityDetail.js',()=>({useSharedActivityDetail:()=>({trip:{id:'t1',isShared:true,readOnly:true},loading:false,error:''})}));
vi.mock('./ActivityDetailScreen.jsx',()=>({default:props=>{mock.owner=props.ownerID;return <div>native detail</div>;}}));
import SharedActivityDetail from './SharedActivityDetail.jsx';
afterEach(cleanup);
// The native detail screen only accepts the signed-in account. Opening someone else's activity from their day on
// the Map passes that person as the owner of the activity; the screen must still be given the viewer, or iOS says "Account changed".
it("opens another person's shared activity on iOS under the signed-in account",()=>{
 render(<SharedActivityDetail activityID="a1" viewer="viewer-id" ownerID="majka-id" ownerName="Majka" onBack={()=>{}}/>);
 expect(mock.owner).toBe('viewer-id');
});
