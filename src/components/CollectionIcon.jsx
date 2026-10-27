import {Bike, Car, Mountain, Package, Sailboat, Snowflake, Tent, Waves, Wind} from 'lucide-react';

// Category icons stay in one place so the Collection list, pickers, chips and
// trip sheets always identify the same kind of equipment.
const ICONS={car:Car,motorcycle:Car,bicycle:Bike,ebike:Bike,kite:Wind,board:Waves,surfboard:Waves,skis:Mountain,snowboard:Snowflake,boat:Sailboat,camper:Tent,other:Package};

export default function CollectionIcon({icon='other',size=18,...props}){
 const Icon=ICONS[icon]||Package;
 return <Icon size={size} aria-hidden="true" {...props}/>;
}
