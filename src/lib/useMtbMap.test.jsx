import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('./supabase.js', () => ({ supabase: null }));
import { useMtbMap } from './useMtbMap.js';
afterEach(cleanup);

it('is inert when Supabase is not configured', () => {
  const { result } = renderHook(() => useMtbMap({ minLat: -33, maxLat: -32, minLon: 151, maxLon: 152 }, ['trails']));
  expect(result.current.trails).toEqual([]);
  expect(result.current.segments).toEqual([]);
  expect(result.current.loading).toBe(false);
  expect(result.current.error).toBe('');
});

it('is inert without a bbox or layers', () => {
  const { result } = renderHook(() => useMtbMap(null, ['trails']));
  expect(result.current.trails).toEqual([]);
  const second = renderHook(() => useMtbMap({ minLat: -33, maxLat: -32, minLon: 151, maxLon: 152 }, []));
  expect(second.result.current.trails).toEqual([]);
});
