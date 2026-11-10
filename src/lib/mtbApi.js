import { supabase } from './supabase.js';

// Reads of public trails and segments by area, for activity details (trail links
// and segment matching). Thin wrappers over the MTB Supabase RPCs. Every call is inert (returns null or
// an empty list) when Supabase is not configured, so the app runs normally without
// a database. Authorisation is enforced server-side, never here.

const bboxArgs = bbox => ({ p_min_lat: bbox.minLat, p_max_lat: bbox.maxLat, p_min_lon: bbox.minLon, p_max_lon: bbox.maxLon });

export async function fetchTrails(bbox) {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('mtb_trails_in_bbox', bboxArgs(bbox));
  if (error) throw new Error(error.message || 'Trails unavailable.');
  return data || [];
}

export async function fetchSegments(bbox) {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('mtb_segments_in_bbox', bboxArgs(bbox));
  if (error) throw new Error(error.message || 'Segments unavailable.');
  return data || [];
}
