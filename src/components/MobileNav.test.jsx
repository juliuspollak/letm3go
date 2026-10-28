import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import MobileNav from './MobileNav.jsx';

afterEach(cleanup);

it('keeps every destination reachable and marks the current one',()=>{
 render(<MobileNav tab="Map" onSelect={()=>{}}/>);
 const nav=screen.getByRole('navigation',{name:'Sections'});
 for(const name of ['Home','Map','Record','Trips','Social'])expect(within(nav).getByRole('button',{name})).toBeInTheDocument();
 expect(within(nav).getByRole('button',{name:'Map'})).toHaveAttribute('aria-current','page');
 expect(within(nav).getByRole('button',{name:'Map'})).toHaveClass('active');
 expect(within(nav).getByRole('button',{name:'Home'})).not.toHaveAttribute('aria-current');
});

it('navigates immediately and only then replays the glyph animation',()=>{
 const onSelect=vi.fn();
 render(<MobileNav tab="Home" onSelect={onSelect}/>);
 const trips=screen.getByRole('button',{name:'Trips'});
 expect(trips.querySelector('.nav-glyph')).toHaveAttribute('data-animate','off');
 fireEvent.click(trips);
 expect(onSelect).toHaveBeenCalledWith('Trips');
 expect(trips.querySelector('.nav-glyph')).toHaveAttribute('data-animate','on');
});

it('announces the live recording state on the record control without changing navigation',()=>{
 const onSelect=vi.fn();
 const {rerender}=render(<MobileNav tab="Trips" onSelect={onSelect} recordState="recording"/>);
 const record=screen.getByRole('button',{name:'Record'});
 expect(record).toHaveAttribute('data-state','recording');
 expect(record).toHaveClass('record-control--nav');
 fireEvent.click(record);
 expect(onSelect).toHaveBeenCalledWith('Record');
 rerender(<MobileNav tab="Record" onSelect={onSelect} recordState="idle"/>);
 expect(screen.getByRole('button',{name:'Record'})).toHaveAttribute('data-state','idle');
});

it('announces recording state changes to assistive technology',()=>{
 const {rerender}=render(<MobileNav tab="Home" onSelect={()=>{}} recordState="recording"/>);
 expect(screen.getByRole('status')).toHaveTextContent('Recording in progress');
 rerender(<MobileNav tab="Home" onSelect={()=>{}} recordState="paused"/>);
 expect(screen.getByRole('status')).toHaveTextContent('Recording paused');
 rerender(<MobileNav tab="Home" onSelect={()=>{}} recordState="auto"/>);
 expect(screen.getByRole('status')).toHaveTextContent('Automatic journey in progress');
 rerender(<MobileNav tab="Home" onSelect={()=>{}} recordState="idle"/>);
 expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('is icon-only on iPhone yet still announces every destination to VoiceOver',()=>{
 render(<MobileNav tab="Home" onSelect={()=>{}}/>);
 for(const name of ['Home','Map','Trips','Social']){
  const button=screen.getByRole('button',{name});
  expect(button).toHaveAttribute('aria-label',name);
  expect(button.querySelector('.nav-label')).not.toBeNull();
 }
 // The old permanent text label under the record control is gone.
 expect(document.querySelector('.mobile-nav-label')).toBeNull();
});

it('draws every destination with one fixed-size vector glyph',()=>{
 render(<MobileNav tab="Home" onSelect={()=>{}}/>);
 for(const name of ['Home','Map','Record','Trips','Social']){
  const button=screen.getByRole('button',{name});
  const glyph=button.querySelector('svg.nav-glyph');
  if(name==='Record')continue;
  expect(glyph).toHaveAttribute('viewBox','0 0 24 24');
  expect(glyph).toHaveAttribute('aria-hidden','true');
 }
});
