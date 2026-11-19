import {Compass} from 'lucide-react';
import {activitySymbol} from '../lib/mapToolbar.js';
import {activityGlyphs} from './activityGlyphs.js';

export default function ActivityIcon({activity,...props}) {
 const Icon=activityGlyphs[activitySymbol(activity)]||Compass;
 return <Icon aria-hidden="true" {...props}/>;
}
