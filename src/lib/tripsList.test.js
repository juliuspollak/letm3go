import {expect,it} from 'vitest';
import {TRIP_PAGE_SIZE,canMergeTrip,tripMatchReason} from './tripsList.js';

const drive={id:'d1',title:'Coast road',activity:'Driving',source:'device',endedAt:1_700_000_600,state:'saved',date:'2026-02-14',stops:[]};

it('pages the list in batches small enough for a phone',()=>{
 expect(TRIP_PAGE_SIZE).toBeGreaterThan(10);
 expect(TRIP_PAGE_SIZE).toBeLessThanOrEqual(60);
});

it('only offers a merge for finished, locally recorded activities',()=>{
 expect(canMergeTrip(drive)).toBe(true);
 expect(canMergeTrip({...drive,endedAt:null,state:'recording'})).toBe(false);
 expect(canMergeTrip({...drive,readOnly:true})).toBe(false);
 expect(canMergeTrip({...drive,provisional:true})).toBe(false);
 expect(canMergeTrip({...drive,source:'tesla'})).toBe(false);
 expect(canMergeTrip({id:'journey:a',isGroupedJourney:true})).toBe(true);
});

it('explains a match from the most specific field first',()=>{
 expect(tripMatchReason(drive,'','')).toBeNull();
 expect(tripMatchReason({...drive,tags:['gravel']},'GRAV')).toEqual({label:'Matched tag',value:'gravel'});
 expect(tripMatchReason({...drive,equipment:[{id:'car-1',name:'Geely'}]},'gee',[{id:'car-1',name:'Geely',category:'car'}])).toEqual({label:'Matched equipment',value:'Geely'});
 expect(tripMatchReason({...drive,stops:[{name:'Lighthouse'}]},'light')).toEqual({label:'Matched stop',value:'Lighthouse'});
 expect(tripMatchReason(drive,'coast')).toEqual({label:'Matched title',value:'Coast road'});
 expect(tripMatchReason(drive,'2026-02-14')).toEqual({label:'Matched date',value:'2026-02-14'});
 expect(tripMatchReason(drive,'nothing here')).toEqual({label:'Matched trip details',value:'nothing here'});
});
