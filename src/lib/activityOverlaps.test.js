import {expect,it} from 'vitest';
import {overlapNotes} from './activityOverlaps.js';

const drive={id:'A-1',title:'Drive',recordingMode:'automatic',details:{}};
const ride={id:'w-1',title:'Morning ride',recordingMode:'watch',details:{overlaps:[{activityID:'a-1',title:'Drive',kind:'automatic',seconds:600}]}};

it('names the duplicate from the Watch activity',()=>{
 expect(overlapNotes(ride,[ride,drive])).toEqual([ride.details.overlaps[0]]);
});
it('names the Watch activity from the automatic activity, without changing either',()=>{
 const before=JSON.stringify([ride,drive]);
 expect(overlapNotes(drive,[ride,drive])).toEqual([{activityID:'w-1',title:'Morning ride',kind:'watch',seconds:600}]);
 expect(JSON.stringify([ride,drive])).toBe(before);
});
it('ends the notice once the other activity has been deleted',()=>{
 expect(overlapNotes(ride,[ride])).toEqual([]);
 expect(overlapNotes(drive,[drive])).toEqual([]);
});
it('keeps the stored notice when the list is not available',()=>{
 expect(overlapNotes(ride)).toEqual(ride.details.overlaps);
});
