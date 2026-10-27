import {act,cleanup,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import AnimatedWordmark from './AnimatedWordmark.jsx';
import {WORDMARK_INTRO,WORDMARK_SEQUENCE} from '../lib/wordmark.js';

function stubReducedMotion(matches){
 window.matchMedia=vi.fn(query=>({matches:query.includes('prefers-reduced-motion')?matches:false,media:query,onchange:null,addEventListener:vi.fn(),removeEventListener:vi.fn(),dispatchEvent:vi.fn()}));
}
beforeEach(()=>{stubReducedMotion(false);});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();});

it('keeps the full brand spelling in fixed slots so letters can never overlap',()=>{
 render(<AnimatedWordmark/>);
 const wordmark=screen.getByRole('img',{name:'letm3go'});
 expect(wordmark).toHaveTextContent('letm3go');
 const letters=[...wordmark.querySelectorAll('.wordmark-letter')];
 expect(letters).toHaveLength(7);
 expect(letters.map(letter=>letter.dataset.letter).join('')).toBe('letm3go');
 expect(letters[4]).toHaveClass('is-accent');
 expect(wordmark.querySelector('.wordmark-arrow .brand-mark')).not.toBeNull();
 expect(wordmark.querySelectorAll('.wordmark-three-lines i')).toHaveLength(3);
});

it('stays completely static when Reduce Motion is enabled',()=>{
 stubReducedMotion(true);
 vi.useFakeTimers();
 render(<AnimatedWordmark/>);
 const wordmark=screen.getByRole('img',{name:'letm3go'});
 expect(wordmark).toHaveAttribute('data-phase','rest');
 act(()=>{vi.advanceTimersByTime(120000);});
 expect(wordmark).toHaveAttribute('data-phase','rest');
});

it('assembles once, then repeats the accent motif on a long cycle',()=>{
 vi.useFakeTimers();
 render(<AnimatedWordmark/>);
 const wordmark=screen.getByRole('img',{name:'letm3go'});
 expect(wordmark).toHaveAttribute('data-phase','intro');
 act(()=>{vi.advanceTimersByTime(WORDMARK_INTRO+1);});
 expect(wordmark).toHaveAttribute('data-phase','rest');
 act(()=>{vi.advanceTimersByTime(WORDMARK_SEQUENCE[0].hold+1);});
 expect(wordmark).toHaveAttribute('data-phase','bars');
 act(()=>{vi.advanceTimersByTime(WORDMARK_SEQUENCE[1].hold+1);});
 expect(wordmark).toHaveAttribute('data-phase','fold');
 act(()=>{vi.advanceTimersByTime(WORDMARK_SEQUENCE[2].hold+1);});
 expect(wordmark).toHaveAttribute('data-phase','compact');
 act(()=>{vi.advanceTimersByTime(WORDMARK_SEQUENCE[3].hold+1);});
 expect(wordmark).toHaveAttribute('data-phase','expand');
 act(()=>{vi.advanceTimersByTime(WORDMARK_SEQUENCE[4].hold+1);});
 expect(wordmark).toHaveAttribute('data-phase','rebuild');
 act(()=>{vi.advanceTimersByTime(WORDMARK_SEQUENCE[5].hold+1);});
 expect(wordmark).toHaveAttribute('data-phase','rest');
 expect(WORDMARK_SEQUENCE.at(-1).hold).toBeGreaterThan(20000);
});

it('stops the loop while the app is hidden and wakes up without the intro',()=>{
 vi.useFakeTimers();
 render(<AnimatedWordmark/>);
 const wordmark=screen.getByRole('img',{name:'letm3go'});
 act(()=>{vi.advanceTimersByTime(WORDMARK_INTRO+1);});
 Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});
 act(()=>{document.dispatchEvent(new Event('visibilitychange'));});
 const paused=wordmark.getAttribute('data-phase');
 act(()=>{vi.advanceTimersByTime(120000);});
 expect(wordmark).toHaveAttribute('data-phase',paused);
 Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});
 act(()=>{document.dispatchEvent(new Event('visibilitychange'));});
 expect(wordmark).toHaveAttribute('data-phase','rest');
});
