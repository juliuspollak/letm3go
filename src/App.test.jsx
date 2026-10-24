import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import App from './App.jsx';
import { emptyRecorder } from './lib/recorder.js';
vi.mock('./lib/config.js', () => ({ config: { configured: false, appleEnabled: false } }));
vi.mock('./lib/supabase.js', () => ({ supabase: null }));
vi.mock('./lib/useRecorder.js',()=>({useRecorder:()=>({state:emptyRecorder,run:vi.fn(),busy:false,error:''})}));
vi.mock('./components/JourneyMap.jsx',()=>({default:()=> <div aria-label="Interactive journey route map"/>}));
afterEach(()=>{cleanup();localStorage.clear();});
it('opens with no invented device history and preserves auth gates',()=>{
 render(<App/>);
 expect(screen.getByText('No device recordings yet.')).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Open The long way to the ocean'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Open profile'}));
 fireEvent.click(screen.getByRole('button',{name:'Sign in or create an account'}));
 expect(screen.getByRole('button',{name:'Sign in',exact:true})).toBeDisabled();
 expect(screen.getByRole('button',{name:'Continue with Apple'})).toBeDisabled();
});
it('keeps demo editing explicit and persists only to the demo key',()=>{
 render(<App/>);
 fireEvent.click(screen.getByRole('button',{name:'Browse labelled demo journeys'}));
 fireEvent.change(screen.getByRole('textbox',{name:'Search journeys'}),{target:{value:'Boranup'}});
 expect(screen.getByRole('heading',{name:'1 journeys'})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Open Among the giants'}));
 fireEvent.click(screen.getByRole('button',{name:'Edit',exact:true}));
 fireEvent.change(screen.getByLabelText('Journey title'),{target:{value:'Our forest ride'}});
 fireEvent.click(screen.getByRole('button',{name:'Save changes'}));
 expect(screen.getByRole('heading',{name:'Our forest ride'})).toBeInTheDocument();
 expect(JSON.parse(localStorage.getItem('letm3go-demo-v1'))[1].title).toBe('Our forest ride');
});
it('does not offer simulated GPS when recording in a browser',()=>{
 render(<App/>);
 fireEvent.click(screen.getByRole('button',{name:'Start activity'}));
 expect(screen.getByText(/Browser previews do not simulate GPS/)).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Start walking'})).toBeDisabled();
});
it('opens diagnostics without exposing credentials',()=>{
 render(<App/>);
 fireEvent.click(screen.getByRole('button',{name:'Open profile'}));
 fireEvent.click(screen.getByRole('button',{name:'Diagnostics'}));
 expect(screen.getByRole('dialog',{name:'Diagnostics'})).toBeInTheDocument();
 expect(screen.getByText('Not implemented')).toBeInTheDocument();
 fireEvent.keyDown(document,{key:'Escape'});
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
