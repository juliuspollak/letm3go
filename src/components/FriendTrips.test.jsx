import { render,screen,cleanup } from '@testing-library/react';
import { afterEach,beforeEach,it,expect,vi } from 'vitest';
const m=vi.hoisted(()=>({rpc:vi.fn()}));vi.mock('../lib/supabase.js',()=>({supabase:m}));
import FriendTrips from './FriendTrips.jsx';
import {feedDistanceKm,sharedDistanceKm} from '../lib/activityCapabilities.js';
afterEach(cleanup);
beforeEach(()=>m.rpc.mockReset());
const row=(trip_id,activity,distance_km)=>({owner_id:'f',display_name:'Majka',trip_id,title:`${activity} ${trip_id}`,activity,started_at:'2026-11-17T01:00:00Z',distance_km});

it("shows a distance only where there is a route to measure, and nothing misleading for workouts",async()=>{
 const feed=[row('gym','Gym',0),row('rope','Rope skipping',null),row('treadmill','Running',0),row('bike','Cycling',null),row('mtb','MTB',12.4),row('walk','Walking',3.26)];
 m.rpc.mockImplementation(async name=>name==='my_friend_trip_feed'?{data:feed,error:null}:{data:[],error:null});
 render(<FriendTrips activities={[]}/>);
 const line=async id=>(await screen.findByText(new RegExp(`${id}$`))).closest('.status-row').textContent;
 expect(await line('gym')).not.toMatch(/km/);
 expect(await line('rope')).not.toMatch(/km/);
 expect(await line('treadmill')).not.toMatch(/km/);     // an older share of an indoor run holds 0
 expect(await line('bike')).not.toMatch(/km/);          // a new share of an indoor ride holds nothing
 expect(await line('mtb')).toMatch(/12\.4 km/);
 expect(await line('walk')).toMatch(/3\.3 km/);
});

it('keeps sharing management in the activity Share sheet',async()=>{
 m.rpc.mockResolvedValue({data:[],error:null});
 render(<FriendTrips activities={[{id:'mine',title:'My ride',startedAt:1,endedAt:2}]}/>);
 expect(await screen.findByText('No shared friend activities yet.')).toBeInTheDocument();
 expect(screen.queryByText('Share one of my activities')).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:/share/i})).not.toBeInTheDocument();
 expect(m.rpc.mock.calls.every(([name])=>name==='my_friend_trip_feed')).toBe(true);
});

it('decides the figure from one rule',()=>{
 expect(feedDistanceKm({activity:'MTB',distance_km:'12.40'})).toBe(12.4);
 for(const r of [{activity:'Gym',distance_km:5},{activity:'Cycling',distance_km:0},{activity:'Cycling',distance_km:null},{activity:'Cycling'},undefined,{activity:'Walking',distance_km:'x'}])expect(feedDistanceKm(r)).toBeNull();
 expect(sharedDistanceKm({activity:'Rope skipping',distanceMeters:900})).toBeNull();
 expect(sharedDistanceKm({activity:'Running',details:{indoor:true},distanceMeters:900})).toBeNull();
 expect(sharedDistanceKm({activity:'Running',distanceMeters:5200})).toBe(5.2);
 expect(sharedDistanceKm({activity:'Running'})).toBe(0);
});
