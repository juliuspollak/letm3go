import {expect,it} from 'vitest';
import {activityTitle,automaticTitle,contextualJourneyTitle} from './activityTitle.js';

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

it('drops the date and time from a generated phone or Watch title: they are shown under it',()=>{
 const trip={activity:'Gym',recordingMode:'watch',title:'Gym · 19 Nov 2026 at 6:30 pm'};
 expect(activityTitle(trip)).toBe('General workout');
 expect(activityTitle({...trip,recordingMode:'manual',title:'Gym · Nov 19, 2026 at 6:30 PM'})).toBe('General workout');
 expect(activityTitle({activity:'Rope skipping',recordingMode:'watch',title:'Rope skipping · 21 Nov 2026 at 11:31 am'})).toBe('Rope skipping');
 expect(activityTitle({activity:'MTB',recordingMode:'manual',title:'MTB · 21 Nov 2026 at 8:05 am'})).toBe('Mountain biking');
});
it('keeps an edited or personal title exactly as written',()=>{
 const trip={activity:'Rope skipping',recordingMode:'watch',title:'Rope skipping · 21 Nov 2026 at 11:31 am'};
 expect(activityTitle({...trip,details:{titleEdited:true}})).toBe(trip.title);
 expect(activityTitle({...trip,title:'Morning skip with the kids'})).toBe('Morning skip with the kids');
 expect(activityTitle({...trip,title:'Rope skipping · Leg day 6:30 pm'})).toBe('Rope skipping · Leg day 6:30 pm');
});

it('does not treat a user-written Gym title as automatic',()=>{
 expect(automaticTitle({activity:'Gym',recordingMode:'manual',title:'Gym · Leg day 6:30 pm'})).toBe(false);
 expect(automaticTitle({activity:'Gym',recordingMode:'manual',title:'Gym · 19 Nov 2026 at 6:30 pm'})).toBe(true);
});
