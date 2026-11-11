import {expect,it} from 'vitest';
import {contextualJourneyTitle} from './activityTitle.js';

const home={name:'Home',kind:'home'};
const grove={name:'Warilla Grove',nearbyName:'Warilla Grove'};
const unknown={name:'Unknown location'};

it('names the destination when it is known',()=>{
 expect(contextualJourneyTitle('Driving',home,grove)).toBe('Driving to Warilla Grove');
 expect(contextualJourneyTitle('Driving',grove,home)).toBe('Driving home');
});
it('never says a drive from Home was "to Home" when the destination is not recognised yet',()=>{
 expect(contextualJourneyTitle('Driving',home,unknown)).toBe('Driving from Home');
 expect(contextualJourneyTitle('Walking',home,unknown)).toBe('Walk from Home');
 expect(contextualJourneyTitle('Cycling',home,unknown)).toBe('Ride from Home');
});
it('keeps loops and unnamed trips as they were',()=>{
 expect(contextualJourneyTitle('Driving',home,unknown,true)).toBe('Drive around Home');
 expect(contextualJourneyTitle('Driving',unknown,unknown)).toBe('Driving');
});
