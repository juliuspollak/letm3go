import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import PublicJourney from './PublicJourney.jsx';
const { invoke }=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('../lib/supabase.js',()=>({supabase:{functions:{invoke}}}));
vi.mock('./JourneyMap.jsx',()=>({default:()=> <div aria-label="Interactive journey route map"/>}));
afterEach(cleanup);
it('renders only the server projection without signing in or querying private trips',async()=>{
 invoke.mockResolvedValue({data:{snapshot:{title:'A shared walk',activity:'Walking',description:'Outdoors',points:[],photos:[]}}});
 render(<PublicJourney token="11111111-1111-4111-8111-111111111111"/>);
 expect(await screen.findByRole('heading',{name:'A shared walk'})).toBeInTheDocument();
 expect(invoke).toHaveBeenCalledWith(expect.stringContaining('journeys?token='),{method:'GET'});
});
it('handles a revoked public link without revealing private details',async()=>{
 invoke.mockResolvedValue({error:new Error('Revoked')});render(<PublicJourney token="11111111-1111-4111-8111-111111111111"/>);
 expect(await screen.findByRole('heading',{name:/unavailable or has been revoked/})).toBeInTheDocument();
});
