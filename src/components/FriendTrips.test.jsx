import { render,screen,cleanup,fireEvent,waitFor,within } from '@testing-library/react';
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

it('shares a workout without GPS with no distance and an outdoor activity with its distance',async()=>{
 m.rpc.mockImplementation(async name=>name==='my_friend_trip_feed'||name==='my_published_friend_trip_ids'?{data:[],error:null}:{error:null});
 const base={startedAt:1_790_000_000,endedAt:1_790_000_900};
 const trips=[{id:'g',title:'Gym',activity:'Gym',distanceMeters:0,...base},{id:'t',title:'Treadmill',activity:'Running',distanceMeters:0,details:{indoor:true},...base},{id:'r',title:'Ride',activity:'MTB',distanceMeters:12400,...base}];
 render(<FriendTrips activities={trips}/>);
 fireEvent.click(screen.getByText('Share one of my activities'));
 const published=()=>m.rpc.mock.calls.filter(([n])=>n==='publish_friend_trip');
 for(const [index,title] of ['Gym','Treadmill','Ride'].entries()){
  fireEvent.click(within(screen.getByText(title).closest('.status-row')).getByRole('button'));
  await waitFor(()=>expect(published()).toHaveLength(index+1));
  await waitFor(()=>expect(within(screen.getByText(title).closest('.status-row')).getByRole('button')).not.toBeDisabled());
 }
 const sent=Object.fromEntries(m.rpc.mock.calls.filter(([n])=>n==='publish_friend_trip').map(([,a])=>[a.p_id,a.p_distance_km]));
 expect(sent).toEqual({g:null,t:null,r:12.4});
});

it('decides the figure from one rule',()=>{
 expect(feedDistanceKm({activity:'MTB',distance_km:'12.40'})).toBe(12.4);
 for(const r of [{activity:'Gym',distance_km:5},{activity:'Cycling',distance_km:0},{activity:'Cycling',distance_km:null},{activity:'Cycling'},undefined,{activity:'Walking',distance_km:'x'}])expect(feedDistanceKm(r)).toBeNull();
 expect(sharedDistanceKm({activity:'Rope skipping',distanceMeters:900})).toBeNull();
 expect(sharedDistanceKm({activity:'Running',details:{indoor:true},distanceMeters:900})).toBeNull();
 expect(sharedDistanceKm({activity:'Running',distanceMeters:5200})).toBe(5.2);
 expect(sharedDistanceKm({activity:'Running'})).toBe(0);
});
