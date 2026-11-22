import {render,cleanup} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
const seen=vi.hoisted(()=>({props:null}));
vi.mock('./AppleMap.jsx',()=>({default:props=>{seen.props=props;return <div data-testid="map"/>;}}));
import PlacePicker from './PlacePicker.jsx';
afterEach(cleanup);
it('gives the live map the pin with its circle, and a Home\'s arrival circle as well',()=>{
 const {rerender}=render(<PlacePicker point={{latitude:-34.5,longitude:150.8}} radius={30} arrivalRadius={100} onPick={()=>{}}/>);
 expect(seen.props.pickable).toBe(true);
 expect(seen.props.payload.pins).toEqual([{point:[-34.5,150.8],title:'Saved place',kind:'place',radius:30,arrivalRadius:100}]);
 // Any other place has just its one circle.
 rerender(<PlacePicker point={{latitude:-34.5,longitude:150.8}} radius={150} onPick={()=>{}}/>);
 expect(seen.props.payload.pins[0]).not.toHaveProperty('arrivalRadius');
 // No pin before a point is chosen.
 rerender(<PlacePicker point={null} radius={150} onPick={()=>{}}/>);
 expect(seen.props.payload.pins).toEqual([]);
});
it('keeps the same payload while nothing about the place changed, so the map is not asked to update',()=>{
 const {rerender}=render(<PlacePicker point={{latitude:-34.5,longitude:150.8}} radius={30} onPick={()=>{}}/>);
 const first=seen.props.payload;
 rerender(<PlacePicker point={{latitude:-34.5,longitude:150.8}} radius={30} onPick={()=>{}}/>);
 expect(seen.props.payload).toBe(first);
 rerender(<PlacePicker point={{latitude:-34.5,longitude:150.8}} radius={31} onPick={()=>{}}/>);
 expect(seen.props.payload).not.toBe(first);
});
it('reports a tap or a full-screen choice as a point, and nothing else',()=>{
 const onPick=vi.fn();
 render(<PlacePicker point={null} radius={150} onPick={onPick}/>);
 seen.props.onPick({latitude:1,longitude:2,extra:true});
 seen.props.onResult({latitude:3,longitude:4});
 seen.props.onResult({cancelled:true});
 seen.props.onPick(undefined);
 expect(onPick.mock.calls).toEqual([[{latitude:1,longitude:2}],[{latitude:3,longitude:4}]]);
});
