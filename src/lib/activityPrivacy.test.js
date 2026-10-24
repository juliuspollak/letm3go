import { expect, it } from 'vitest';
import { redactRoute, publicationPreview } from './activityPrivacy.js';
const home={kind:'home',latitude:0,longitude:0,radius:100};
it('hides Home plus buffer and strips raw telemetry',()=>{
 const route=redactRoute([{latitude:0,longitude:0,segment:0,timestamp:100,accuracy:8},{latitude:0,longitude:.01,segment:0,timestamp:200,accuracy:8}],[home]);
 expect(route).toEqual([{latitude:0,longitude:.01,segment:1}]);
 expect(route[0]).not.toHaveProperty('timestamp');
});
it('breaks an edge crossing Home even if both samples are outside',()=>{
 const result=redactRoute([{latitude:0,longitude:-.01,segment:0},{latitude:0,longitude:.01,segment:0}],[home]);
 expect(result[0].segment).not.toBe(result[1].segment);
});
it('preserves original signal gaps',()=>{
 const result=redactRoute([{latitude:1,longitude:1,segment:0},{latitude:1,longitude:1.001,segment:1}],[]);
 expect(result[0].segment).not.toBe(result[1].segment);
});
it('shares only explicitly selected photos away from sensitive places',()=>{
 const preview=publicationPreview({title:'Walk',activity:'Walking',points:[],photos:[{id:'home',caption:'Home',point:[0,0],locationSource:'gps'},{id:'beach',caption:'Beach',point:[1,1],locationSource:'gps'},{id:'private',caption:'Private'}]},[home],['home','beach']);
 expect(preview.photos).toEqual([{id:'beach',caption:'Beach'}]);
});
