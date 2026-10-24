import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Places from './Places.jsx';
vi.mock('../lib/recorder.js',()=>({recorderAvailable:()=>true}));
vi.mock('./PlacePicker.jsx',()=>({default:({onPick})=><button onClick={()=>onPick({latitude:1,longitude:2})}>Choose map point</button>}));
afterEach(cleanup);
it('requires current-position confirmation before saving a private place',async()=>{
 const run=vi.fn().mockResolvedValue({latitude:1,longitude:2,accuracy:10});render(<Places places={[]} run={run}/>);
 fireEvent.click(screen.getByRole('button',{name:'Add a private place'}));
 fireEvent.change(screen.getByLabelText('Place name'),{target:{value:'Home'}});
 expect(screen.getByRole('button',{name:'Save private place'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Use current position'}));
 await screen.findByRole('button',{name:'Confirm this position'});
 expect(screen.getByRole('button',{name:'Save private place'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Confirm this position'}));
 fireEvent.click(screen.getByRole('button',{name:'Save private place'}));
 await waitFor(()=>expect(run).toHaveBeenCalledWith('savePlace',expect.objectContaining({name:'Home',latitude:1,longitude:2,radius:150})));
});
