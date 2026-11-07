import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const { invoke }=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('../lib/supabase.js',()=>({supabase:{functions:{invoke}}}));
vi.mock('@capacitor/core',async original=>{const actual=await original();return {...actual,Capacitor:{...actual.Capacitor,getPlatform:()=>'web',isNativePlatform:()=>false}};});
vi.mock('./JourneyMap.jsx',()=>({default:()=> <div aria-label="Interactive journey route map"/>}));
vi.mock('./ActivityDetailScreen.jsx',()=>({default:()=> <div>native detail</div>}));
import SharedActivityDetail from './SharedActivityDetail.jsx';
afterEach(()=>{cleanup();invoke.mockReset();});
// A public link (the replacement for PublicJourney): only the server projection,
// no sign-in and no private recording.
it('renders only the server projection for a public link, without signing in',async()=>{
 invoke.mockResolvedValue({data:{snapshot:{title:'A shared walk',activity:'Walking',description:'Outdoors',points:[{latitude:-34.4,longitude:150.9,segment:0},{latitude:-34.41,longitude:150.91,segment:0}],photos:[]}}});
 render(<SharedActivityDetail token="11111111-1111-4111-8111-111111111111" onBack={()=>{}}/>);
 expect(await screen.findByRole('heading',{name:'A shared walk'})).toBeInTheDocument();
 expect(screen.getByLabelText('Interactive journey route map')).toBeInTheDocument();
 expect(invoke).toHaveBeenCalledWith(expect.stringContaining('journeys?token='),{method:'GET'});
});
it('says a revoked public link is unavailable without revealing anything',async()=>{
 invoke.mockResolvedValue({error:new Error('Revoked')});
 render(<SharedActivityDetail token="11111111-1111-4111-8111-111111111111" onBack={()=>{}}/>);
 expect(await screen.findByRole('heading',{name:/unavailable or access has been revoked/})).toBeInTheDocument();
 expect(screen.queryByText('Outdoors')).not.toBeInTheDocument();
});
