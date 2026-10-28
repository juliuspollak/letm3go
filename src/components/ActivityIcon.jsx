import {Bike,Car,Footprints,Mountain,Waves} from 'lucide-react';

// One glyph per activity so a route, a walk and a drive are distinguishable at a
// glance in every list and detail screen.
export default function ActivityIcon({activity,...props}) {
 const Icon=activity?.toLowerCase().includes('biking')||activity?.toLowerCase().includes('cycling')||activity==='MTB'?Bike:activity==='Driving'?Car:activity==='Kitesurfing'?Waves:activity==='Hiking'?Mountain:Footprints;
 return <Icon {...props}/>;
}
