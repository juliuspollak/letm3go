import {render,screen,cleanup} from '@testing-library/react';
import {afterEach,describe,expect,it} from 'vitest';
import LoadingMark from './LoadingMark.jsx';
afterEach(cleanup);
describe('LoadingMark',()=>{
 it('draws and announces only one spinner however many ask at once',()=>{
  render(<><LoadingMark label="Loading household"/><LoadingMark label="Loading members"/><LoadingMark label="Loading list"/></>);
  const marks=screen.getAllByRole('status');
  expect(marks).toHaveLength(1);
  expect(marks[0]).toHaveAccessibleName('Loading household');
 });
 it('hands over to the next one when the first goes away, and disappears when none is left',()=>{
  const {rerender}=render(<><LoadingMark label="first"/><LoadingMark label="second"/></>);
  rerender(<LoadingMark label="second"/>);
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('status')).toHaveAccessibleName('second');
  rerender(<></>);
  expect(screen.queryByRole('status')).toBeNull();
 });
 it('keeps the inline spinner separate: it replaces a button label and is not part of the page overlay',()=>{
  render(<><LoadingMark label="page"/><button><LoadingMark label="inline" inline/></button></>);
  expect(screen.getAllByRole('status')).toHaveLength(2);
 });
});
