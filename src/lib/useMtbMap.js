import { useEffect, useState } from 'react';
import { supabase } from './supabase.js';
import { simplifyGeometry } from './mtb.js';

const empty = { trails: [], segments: [], loading: false, error: '' };

// Fetches approved public trails/segments within a bounding box and simplifies each
// polyline for display. Inert (empty, no network) when Supabase is not configured,
// so the rest of the app runs normally without a database.
export function useMtbMap(bbox, layers = []) {
  const [state, setState] = useState(empty);
  const bboxKey = bbox ? [bbox.minLat, bbox.maxLat, bbox.minLon, bbox.maxLon].join(',') : '';
  const layersKey = layers.join(',');
  useEffect(() => {
    let alive = true;
    const run = () => {
      if (!alive) return;
      if (!supabase || !bbox || !layers.length) { setState(empty); return; }
      const args = { p_min_lat: bbox.minLat, p_max_lat: bbox.maxLat, p_min_lon: bbox.minLon, p_max_lon: bbox.maxLon };
      const load = async () => {
        try {
          const [trails, segments] = await Promise.all([
            layers.includes('trails') ? supabase.rpc('mtb_trails_in_bbox', args) : { data: [], error: null },
            layers.includes('segments') ? supabase.rpc('mtb_segments_in_bbox', args) : { data: [], error: null },
          ]);
          if (!alive) return;
          const err = trails.error || segments.error;
          if (err) { setState({ trails: [], segments: [], loading: false, error: err.message || 'Trails unavailable.' }); return; }
          setState({
            trails: (trails.data || []).map(t => ({ ...t, geometry: simplifyGeometry(t.geometry, 12) })),
            segments: (segments.data || []).map(s => ({ ...s, geometry: simplifyGeometry(s.geometry, 12) })),
            loading: false, error: '',
          });
        } catch (e) {
          if (alive) setState({ trails: [], segments: [], loading: false, error: e.message || 'Trails unavailable.' });
        }
      };
      setState(prev => ({ ...prev, loading: true, error: '' }));
      void load();
    };
    const timer = setTimeout(run, 0);
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- primitive keys are the real dependencies
  }, [bboxKey, layersKey]);
  return state;
}
