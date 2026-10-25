import { render,screen,fireEvent,cleanup } from '@testing-library/react';
import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import SwipeBack from './SwipeBack.jsx';
beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal('matchMedia',()=>({matches:true}));});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
function swipe(target,x,y=30){fireEvent.touchStart(target,{touches:[{clientX:x,clientY:30}]});fireEvent.touchMove(target,{touches:[{clientX:x+350,clientY:y}]});fireEvent.touchEnd(target,{touches:[]});vi.runAllTimers();}
it('navigates back with a rightward edge swipe, including the page margin',()=>{const back=vi.fn();render(<SwipeBack onBack={back}><p>Detail</p></SwipeBack>);swipe(document.body,4);expect(back).toHaveBeenCalledOnce();});
it('preserves vertical scrolling, central gestures, controls and modal interactions',()=>{const back=vi.fn();render(<SwipeBack onBack={back}><p>Detail</p><input aria-label="Caption"/></SwipeBack>);swipe(screen.getByText('Detail'),100);swipe(screen.getByLabelText('Caption'),10);swipe(document.body,10,500);const modal=document.createElement('div');modal.setAttribute('aria-modal','true');document.body.append(modal);swipe(document.body,10);modal.remove();expect(back).not.toHaveBeenCalled();});
it('cancels an interrupted swipe without navigating away',()=>{const back=vi.fn();render(<SwipeBack onBack={back}><p>Detail</p></SwipeBack>);fireEvent.touchStart(document.body,{touches:[{clientX:5,clientY:30}]});fireEvent.touchMove(document.body,{touches:[{clientX:300,clientY:30}]});fireEvent.touchCancel(document.body);vi.runAllTimers();expect(back).not.toHaveBeenCalled();});
