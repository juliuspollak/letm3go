import {act,cleanup,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import LoadingScreen,{TopProgress} from './LoadingScreen.jsx';

describe('LoadingScreen',()=>{
 beforeEach(()=>vi.useFakeTimers());
 afterEach(()=>{cleanup();vi.useRealTimers();});
 it('shows the message, then says so when the wait is long',()=>{
  render(<LoadingScreen message="Restoring your private world…" slowMessage="Still working." slowAfter={4000}/>);
  expect(screen.getByRole('status').textContent).toBe('Restoring your private world…');
  act(()=>{vi.advanceTimersByTime(3999);});
  expect(screen.getByRole('status').textContent).toBe('Restoring your private world…');
  act(()=>{vi.advanceTimersByTime(1);});
  expect(screen.getByRole('status').textContent).toBe('Still working.');
 });
 it('starts the wait again when the message changes',()=>{
  const {rerender}=render(<LoadingScreen message="A" slowMessage="slow" slowAfter={1000}/>);
  act(()=>{vi.advanceTimersByTime(1000);});
  expect(screen.getByRole('status').textContent).toBe('slow');
  rerender(<LoadingScreen message="B" slowMessage="slow" slowAfter={1000}/>);
  expect(screen.getByRole('status').textContent).toBe('B');
 });
 it('renders the top bar only while active',()=>{
  const {rerender}=render(<TopProgress active={false}/>);
  expect(screen.queryByRole('progressbar')).toBeNull();
  rerender(<TopProgress active/>);
  expect(screen.getByRole('progressbar')).toBeTruthy();
 });
});
