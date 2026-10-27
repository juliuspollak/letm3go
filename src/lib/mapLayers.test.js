import {expect,it} from 'vitest';
import {mapLayerJourneys,toggleMapLayer} from './mapLayers.js';
it('includes grouped journeys when a segment matches today or a saved activity',()=>{
 const journeys=[{id:'group',date:'2026-10-26',segments:[{date:'2026-10-27'}],segmentIDs:['recording']},{id:'older',date:'2026-10-25'}];
 expect(mapLayerJourneys(journeys,['people','today'],'2026-10-27')).toEqual([journeys[0]]);
 expect(mapLayerJourneys(journeys,['pinned'],'2026-10-27',['recording'])).toEqual([journeys[0]]);
 expect(mapLayerJourneys(journeys,['all'],'2026-10-27')).toEqual(journeys);
 expect(mapLayerJourneys(journeys,['people'],'2026-10-27')).toEqual([]);
});
it('can turn the selected route scope off without turning people off',()=>{
 expect(toggleMapLayer(['people','all'],'all')).toEqual(['people']);
 expect(toggleMapLayer(['people','all'],'today')).toEqual(['people','today']);
});
