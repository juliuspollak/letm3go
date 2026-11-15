import {describe,expect,it} from 'vitest';
import {temperatureText,weatherKind,weatherOf,weatherText} from './weather.js';
describe('weather',()=>{
 it('maps symbols to icons',()=>{
  expect(weatherKind('sun.max.fill')).toBe('sun');
  expect(weatherKind('cloud.sun.fill')).toBe('partly');
  expect(weatherKind('cloud.bolt.rain.fill')).toBe('storm');
  expect(weatherKind('wind')).toBe('wind');
  expect(weatherKind('cloud.heavyrain.fill')).toBe('rain');
  expect(weatherKind('cloud.fill')).toBe('cloud');
 });
 it('words it',()=>{
  const w={condition:'Mostly Sunny',symbol:'sun.max',temperatureC:23.6,windKph:35};
  expect(temperatureText(23.6)).toBe('24°');
  expect(weatherText(w)).toBe('Mostly Sunny · 24° · wind 35 km/h');
  expect(weatherOf({details:{weather:w}})).toBe(w);
  expect(weatherOf({details:{}})).toBe(null);
 });
});
