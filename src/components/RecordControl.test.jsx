import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import RecordControl from './RecordControl.jsx';
import {recordControlState} from '../lib/recordingState.js';

afterEach(cleanup);

const states=[
 [{},false,'idle'],
 [{active:{state:'recording'}},false,'recording'],
 [{active:{state:'paused'}},false,'paused'],
 [{automaticTrip:{activity:'Walking'}},false,'auto'],
 [{automaticState:'recording'},false,'auto'],
 [{},true,'starting'],
 [{active:{state:'recording'}},true,'saving']
];

it('maps every recorder state to one control state',()=>{
 for(const [state,busy,expected] of states)expect(recordControlState(state,busy)).toBe(expected);
 expect(recordControlState()).toBe('idle');
});

it('stays a single labelled button in every state',()=>{
 const onClick=vi.fn();
 const {rerender}=render(<RecordControl state="idle" label="Record" onClick={onClick}/>);
 expect(screen.getByRole('button',{name:'Record'})).toHaveAttribute('data-state','idle');
 fireEvent.click(screen.getByRole('button',{name:'Record'}));
 expect(onClick).toHaveBeenCalledTimes(1);
 for(const [, , expected] of states){
  rerender(<RecordControl state={expected} label="Record" onClick={onClick}/>);
  expect(screen.getByRole('button',{name:'Record'})).toHaveAttribute('data-state',expected);
 }
});

it('reports busy work without ever hiding the action',()=>{
 render(<RecordControl state="starting" label="Start walking" disabled/>);
 const button=screen.getByRole('button',{name:'Start walking'});
 expect(button).toHaveAttribute('aria-busy','true');
 expect(button).toBeDisabled();
 expect(button.querySelector('.record-control-spinner')).not.toBeNull();
});

it('keeps the recording state visible for assistive technology',()=>{
 render(<RecordControl state="recording" label="Finish" variant="panel"/>);
 const button=screen.getByRole('button',{name:'Finish'});
 expect(button).toHaveClass('record-control--panel');
 expect(button).toHaveClass('is-recording');
 expect(button).not.toHaveAttribute('aria-busy');
 expect(button.querySelector('.record-control-halo')).not.toBeNull();
});
