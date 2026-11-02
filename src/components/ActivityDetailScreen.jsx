import ActivityDetail from './ActivityDetail.jsx';
import NativeActivityDetail from './NativeActivityDetail.jsx';
import {nativeDetailsEnabled} from '../lib/nativeActivityDetails.js';

// The one place that chooses between the two complete screens.
export default function ActivityDetailScreen(props){
 return nativeDetailsEnabled()?<NativeActivityDetail {...props}/>:<ActivityDetail {...props}/>;
}
