import {cleanup,render} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
const captured=vi.hoisted(()=>({props:null}));
vi.mock('./AppleMap.jsx',()=>({default:props=>{captured.props=props;return null;}}));
import JourneyMap from './JourneyMap.jsx';
afterEach(cleanup);

const ride={id:'ride',title:'Ride',routeSegments:[[[-33.86,151.2],[-33.87,151.21]]],photos:[{id:'p1',point:[-33.86,151.2]},{id:'p2',point:[-33.87,151.21]}]};
const walk={id:'walk',title:'Walk',routeSegments:[[[-33.9,151.1],[-33.91,151.11]]],photos:[{id:'p3',point:[-33.9,151.1]}]};

it('opens the journey or the photo the preview card asked for, and only for that journey',()=>{
 const onPhoto=vi.fn(),onJourney=vi.fn();
 render(<JourneyMap journeys={[ride,walk]} onPhoto={onPhoto} onJourney={onJourney} overview={{key:'d1'}}/>);
 captured.props.onResult({photoID:'p2',journeyID:'ride',action:'journey'});
 expect(onJourney).toHaveBeenCalledWith(ride);
 captured.props.onResult({photoID:'p3',journeyID:'walk',action:'photo'});
 expect(onPhoto).toHaveBeenCalledWith(walk,'p3');
 // A photo is never attributed to a journey it does not belong to, and an
 // unknown journey opens nothing.
 captured.props.onResult({photoID:'p3',journeyID:'ride',action:'journey'});
 captured.props.onResult({photoID:'p1',journeyID:'elsewhere',action:'photo'});
 captured.props.onResult({cancelled:true});
 expect(onJourney).toHaveBeenCalledTimes(1);
 expect(onPhoto).toHaveBeenCalledTimes(1);
});
it('keeps opening the photo directly on single-journey maps',()=>{
 const onPhoto=vi.fn();
 render(<JourneyMap journeys={[ride]} onPhoto={onPhoto}/>);
 captured.props.onResult({photoID:'p1',journeyID:'ride'});
 expect(onPhoto).toHaveBeenCalledWith(ride,'p1');
 expect(captured.props.payload.pins.filter(pin=>['start','finish'].includes(pin.kind))).toHaveLength(2);
 expect(captured.props.payload).not.toHaveProperty('overview');
});
it('names the overview in the payload and passes the Map controls through',()=>{
 const onControl=vi.fn(),controls={active:2};
 render(<JourneyMap journeys={[ride,walk]} overview={{key:'d1',levels:[]}} controls={controls} onControl={onControl}/>);
 expect(captured.props.payload).toMatchObject({overview:'d1',routes:[],gaps:[]});
 expect(captured.props.payload.pins.some(pin=>['start','finish','photo'].includes(pin.kind))).toBe(false);
 expect(captured.props).toMatchObject({controls,onControl,overview:{key:'d1'}});
});

it('reuses the previous route payload when only unrelated props change',()=>{
 const journeys=[ride];
 const {rerender}=render(<JourneyMap journeys={journeys}/>);
 const first=captured.props.payload;
 // A re-render that does not change the map content must not rebuild the route
 // payload: long recordings are serialised once and reused across pin selections.
 rerender(<JourneyMap journeys={journeys} large={false} embeddedEnabled={true}/>);
 expect(captured.props.payload).toBe(first);
});

it('highlights only the selected photo while retaining the route and rejecting unrelated photo events',()=>{
 render(<JourneyMap journeys={[ride]} selectedPhotoID="p2"/>);
 expect(captured.props.payload.pins.filter(pin=>pin.selected).map(pin=>pin.photoID)).toEqual(['p2']);
 expect(captured.props.payload.routes).toEqual(ride.routeSegments);
});

it('draws a person\'s day on the same map: their payload, updated in place, with the existing camera callback and scoped controls', ()=>{
 const onStep=vi.fn(),onControl=vi.fn(),onLocate=vi.fn(),onPersonControl=vi.fn(),personLocate=vi.fn();
 const date={label:'Today',previous:{id:'pday:prev'},next:{id:'pday:next'}};
 const controls={active:2,filters:{id:'panel:filters'},layers:{id:'panel:layers'},date:{label:'Map date'},panel:null};
 const day={payload:{routes:[[[1,2],[3,4]]],pins:[],fitKey:'her|2026-11-11'},onStep,date,onControl:onPersonControl,onLocate:personLocate,locating:true};
 const {rerender}=render(<JourneyMap journeys={[ride]} overview={{key:'d1'}} camera={{mode:'all'}} onCamera={vi.fn()} onRegion={vi.fn()} onSegment={vi.fn()} controls={controls} onControl={onControl} onLocate={onLocate} personDay={day}/>);
 expect(captured.props.payload).toMatchObject({...day.payload,camera:{mode:'all',includeRoutes:false}});
 expect(captured.props).toMatchObject({dynamic:true,onStep,overview:null,onRegion:null,onSegment:null,locating:true});
 // Layers stay, Filters go, the date bar is the person's own, and Locate belongs to the person.
 expect(captured.props.controls.filters).toBeUndefined();
 expect(captured.props.controls.layers).toBe(controls.layers);
 expect(captured.props.controls.date).toBe(date);
 expect(captured.props.onLocate).toBe(personLocate);
 // The person's date buttons go to the person; everything else goes to the Map.
 captured.props.onControl('pday:prev');captured.props.onControl('segments');
 expect(onPersonControl).toHaveBeenCalledWith('pday:prev');expect(onControl).toHaveBeenCalledWith('segments');expect(onControl).not.toHaveBeenCalledWith('pday:prev');
 // Back to All people: the layers return exactly as they were.
 rerender(<JourneyMap journeys={[ride]} overview={{key:'d1'}} camera={{mode:'all'}} controls={controls} onControl={onControl} onLocate={onLocate}/>);
 expect(captured.props.payload).toMatchObject({overview:'d1'});
 expect(captured.props).toMatchObject({dynamic:false,overview:{key:'d1'},controls,onLocate});
});
it('keeps the open Layers panel in a person\'s day, and drops a Filters panel that does not apply', ()=>{
 const day={payload:{routes:[],pins:[],fitKey:'x'},date:{label:'Today'},onControl:vi.fn(),onLocate:vi.fn()};
 const layersPanel={id:'layers',sections:[{id:'style'},{id:'community'}]};
 const {rerender}=render(<JourneyMap journeys={[]} controls={{active:0,layers:{},panel:layersPanel,date:null}} personDay={day}/>);
 expect(captured.props.controls.panel.id).toBe('layers');expect(captured.props.controls.date).toBeNull();
 expect(captured.props.controls.panel.sections.map(s=>s.id)).toEqual(['style']); // Segments and Friends' journeys are not offered where they would draw nothing
 rerender(<JourneyMap journeys={[]} controls={{active:0,layers:{},panel:{id:'filters'},date:null}} personDay={day}/>);
 expect(captured.props.controls.panel).toBeNull();expect(captured.props.controls.date).toBe(day.date);
});

it('uses the same Filters/Layers positions with person activity options and preserves the native camera callback',()=>{
 const onCamera=vi.fn(),onControl=vi.fn();
 const filters={active:1,sections:[{id:'activity',options:[{id:'pday:activity:Driving'}]}]};
 const day={payload:{routes:[],pins:[]},filters,date:{label:'Today'},onControl};
 render(<JourneyMap journeys={[]} personDay={day} camera={{key:'people:me',mode:'free',command:3}} onCamera={onCamera} controls={{filters:{id:'panel:filters'},layers:{id:'panel:layers'},panel:{id:'filters'}}}/>);
 expect(captured.props.onCamera).toBe(onCamera);
 expect(captured.props.controls.filters).toMatchObject({id:'panel:filters',count:1,expanded:true});
 expect(captured.props.controls.panel.sections).toBe(filters.sections);
 captured.props.onControl('pday:activity:Driving');expect(onControl).toHaveBeenCalledWith('pday:activity:Driving');
});
