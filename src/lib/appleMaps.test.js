import { readFileSync } from 'node:fs';
import { describe,expect,it,vi } from 'vitest';
vi.mock('@capacitor/core',()=>({Capacitor:{getPlatform:()=> 'ios'},registerPlugin:()=>({})}));
import { appleMaps, mapPayload } from './appleMaps.js';
it('preserves route gaps and forwards photo references without private image paths or GPS timestamps',()=>{
 const payload=mapPayload([{id:'trip',routeSegments:[[[1,2],[1.0001,2.0001]],[[1.01,2.01],[1.0101,2.0101]]],photos:[{id:'photo',point:[3,4],caption:'Stop',url:'private://secret',exif:{secret:true}}],route:[],startedAt:'secret'}]);
 expect(payload.routes).toEqual([[[1,2],[1.0001,2.0001]],[[1.01,2.01],[1.0101,2.0101]]]);
 expect(payload.pins.find(p=>p.kind==='photo')).toEqual({point:[3,4],title:'Stop',kind:'photo',journeyID:'trip',photoID:'photo'});
 expect(JSON.stringify(payload)).not.toContain('secret');
});
it('rejects non-finite and out-of-range locations and includes current-location accuracy',()=>{
 const result=mapPayload([{route:[[NaN,2],[100,4],[1,2]],photos:[]}],{latitude:0,longitude:0,accuracy:25});
 expect(result.routes).toEqual([[[1,2]]]);expect(result.pins.at(-1)).toMatchObject({point:[0,0],radius:25,kind:'location'});
});

it('provides a native photo-selection event subscription used by embedded maps',()=>{
 expect(typeof appleMaps.addListener).toBe('function');
});
it('emits dashed connectors between close consecutive segments',()=>{
 const p=mapPayload([{id:'trip',routeSegments:[[[-33,151],[-33.001,151]],[[-33.002,151],[-33.003,151]],[[-34,152]]]}]);
 expect(p.routes).toEqual([[[-33,151],[-33.001,151]],[[-33.002,151],[-33.003,151]],[[-34,152]]]); // segments preserved; native skips 1-point polylines
 expect(p.gaps).toEqual([[[-33.001,151],[-33.002,151]]]); // close segments joined by a dashed connector
 expect(p.pins.map(pin=>pin.kind)).toEqual(['start','finish']);
});
it('does not connect segments separated by a large gap, avoiding a direct-looking route',()=>{
 const p=mapPayload([{id:'trip',routeSegments:[[[-33,151],[-33.001,151]],[[-33.03,151],[-33.031,151]]]}]); // ~3.3km apart
 expect(p.gaps).toEqual([]);
});
it('marks opted-in friends separately from household members on the map',()=>{
 const p=mapPayload([],null,null,[{latitude:-34.6,longitude:150.87,display_name:'Friend',source:'friend'},{latitude:-34.7,longitude:150.8,display_name:'Family'}]);
 expect(p.pins.map(pin=>pin.kind)).toEqual(['friend-live','family-live']);
});
it('does not label native-size chunks of a detailed continuous route as GPS gaps',()=>{
 const origin=[-34.56,150.86],cos=Math.cos(origin[0]*Math.PI/180);
 const route=Array.from({length:3000},(_,i)=>[origin[0]+(i%2?10:0)/111320,origin[1]+i*10/(111320*cos)]);
 const before=JSON.stringify(route),payload=mapPayload([{id:'detailed',route}]);
 expect(payload.routes.length).toBeGreaterThan(1);
 expect(payload.routes[0].at(-1)).toEqual(payload.routes[1][0]);
 expect(payload.gaps).toEqual([]);expect(payload.pins[0].point).toEqual(route[0]);expect(payload.pins[1].point).toEqual(route.at(-1));
 expect(JSON.stringify(route)).toBe(before);
});

// swiftc does not run on every machine that changes this code, and the design rests
// on these lines: real touches reach MapKit, and a button dies with its map.
describe('native overlay map source',()=>{
 const swift=readFileSync('ios/App/App/AppleMaps.swift','utf8');
 const controller=readFileSync('ios/App/App/LocationRecorder.swift','utf8');
 it('routes real touches to MapKit instead of translating web gestures into regions',()=>{
  expect(controller).toContain('OverlayTouchWebView(frame:frame,configuration:configuration)');
  expect(swift).toContain('return map.hitTest(webView.convert(point,to:map),with:event)');
  expect(swift).not.toMatch(/overlayPanned|overlayPinched|overlayTapped|installOverlayGestures/);
 });
 it('keeps the Full screen button on its map and removes it with the map',()=>{
  expect(swift).not.toContain('webView.addSubview(button)');
  expect(swift).toContain('self.expandButtons.removeValue(forKey:id)?.removeFromSuperview()');
  expect(swift).toMatch(/func unembed[\s\S]{0,120}self\.removeMap\(id\)/);
 });
 it('never records a boundary for a map that has gone',()=>{
  expect(swift).toMatch(/func setOverlayInset[\s\S]{0,200}self\.overlayMaps\.contains\(id\)/);
 });
});
