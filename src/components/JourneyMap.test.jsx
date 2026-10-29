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
it('names the overview in the payload and passes the Layers control through',()=>{
 const onLayers=vi.fn();
 render(<JourneyMap journeys={[ride,walk]} overview={{key:'d1',levels:[]}} onLayers={onLayers} layersActive={2}/>);
 expect(captured.props.payload).toMatchObject({overview:'d1',routes:[],gaps:[]});
 expect(captured.props.payload.pins.some(pin=>['start','finish','photo'].includes(pin.kind))).toBe(false);
 expect(captured.props).toMatchObject({onLayers,layersActive:2,overview:{key:'d1'}});
});
