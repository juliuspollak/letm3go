import {describe,expect,it} from 'vitest';
import {
 MAP_MIN_VISIBLE,adjacentDetent,dragHeight,nearestDetent,settleDetent,sheetHeight,sheetStyle
} from './activitySheet.js';

describe('activity sheet detents',()=>{
 it('keeps a usable amount of map visible at every detent',()=>{
  for(const detent of ['peek','medium','full'])expect(844-sheetHeight(detent,844)).toBeGreaterThanOrEqual(MAP_MIN_VISIBLE);
  expect(sheetHeight('peek',844)).toBeLessThan(sheetHeight('medium',844));
  expect(sheetHeight('medium',844)).toBeLessThan(sheetHeight('full',844));
 });
 it('never exceeds a small screen, so the map and the sheet both stay on screen',()=>{
  expect(sheetHeight('full',390)).toBe(390-MAP_MIN_VISIBLE);
  expect(sheetHeight('peek',320)).toBeGreaterThanOrEqual(180);
 });
 it('clamps a drag to the allowed range instead of collapsing the sheet',()=>{
  // 844 - 140 keeps the map visible, so the sheet cannot grow past 704.
  expect(dragHeight(400,600,200,844)).toBe(704);
  expect(dragHeight(400,600,900,844)).toBe(180);
  expect(dragHeight(400,600,550,844)).toBe(450);
 });
 it('snaps to the closest detent and honours a flick',()=>{
  expect(nearestDetent(270,844)).toBe('peek');
  expect(nearestDetent(500,844)).toBe('medium');
  expect(nearestDetent(700,844)).toBe('full');
  expect(adjacentDetent('medium',1)).toBe('full');
  expect(adjacentDetent('medium',-1)).toBe('peek');
  expect(adjacentDetent('full',1)).toBe('full');
  expect(adjacentDetent('peek',-1)).toBe('peek');
  // A short, fast flick up from just above medium still opens fully.
  expect(settleDetent({startHeight:470,currentHeight:500,viewportHeight:844,velocity:900})).toBe('full');
  expect(settleDetent({startHeight:470,currentHeight:500,viewportHeight:844,velocity:-900})).toBe('peek');
  // Without velocity the resting position decides.
  expect(settleDetent({startHeight:470,currentHeight:480,viewportHeight:844})).toBe('medium');
 });
 it('exposes only a height custom property to CSS',()=>{
  expect(sheetStyle(412.6)).toEqual({'--activity-sheet-height':'413px'});
 });
});
