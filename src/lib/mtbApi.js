import { supabase } from './supabase.js';

// Thin wrappers over the MTB Supabase RPCs. Every call is inert (returns null or
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

export async function createTrail({ name, geometry, distanceMeters, description, surface, difficulty, access, direction }) {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('create_mtb_trail', {
    p_name: name, p_geometry: geometry, p_distance_meters: distanceMeters,
    p_description: description || '', p_surface: surface || null, p_difficulty: difficulty || null,
    p_access: access || 'unknown', p_source: 'manual', p_direction: direction || 'both',
  });
  if (error) throw new Error(error.message || 'Trail could not be created.');
  return data;
}

export async function createSegment({ name, geometry, distanceMeters, description, trailId, direction, difficulty, access }) {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('create_mtb_segment', {
    p_name: name, p_geometry: geometry, p_distance_meters: distanceMeters,
    p_description: description || '', p_trail_id: trailId || null, p_direction: direction || 'both',
    p_difficulty: difficulty || null, p_access: access || 'unknown',
  });
  if (error) throw new Error(error.message || 'Segment could not be created.');
  return data;
}

export async function submitMtb(kind, id) {
  if (!supabase) return;
  const { error } = await supabase.rpc('submit_mtb', { p_kind: kind, p_id: id });
  if (error) throw new Error(error.message || 'Could not submit.');
}

export async function moderateMtb(kind, id, action, note = '') {
  if (!supabase) return;
  const { error } = await supabase.rpc('moderate_mtb', { p_kind: kind, p_id: id, p_action: action, p_note: note });
  if (error) throw new Error(error.message || 'Moderation action failed.');
}

export async function mySubmissions() {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('mtb_my_submissions');
  if (error) throw new Error(error.message || 'Your submissions are unavailable.');
  return data || [];
}

export async function setGeometry(kind, id, geometry, distanceMeters, note = '') {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('mtb_set_geometry', { p_kind: kind, p_id: id, p_geometry: geometry, p_distance_meters: distanceMeters, p_note: note });
  if (error) throw new Error(error.message || 'Geometry could not be saved.');
  return data;
}

export async function segmentsNear(id, radiusMeters = 250) {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('mtb_segments_near', { p_segment_id: id, p_radius_meters: radiusMeters });
  if (error) throw new Error(error.message || 'Duplicate check unavailable.');
  return data || [];
}

export async function moderationQueue() {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('mtb_moderation_queue');
  if (error) throw new Error(error.message || 'Moderation queue unavailable.');
  return data || [];
}

