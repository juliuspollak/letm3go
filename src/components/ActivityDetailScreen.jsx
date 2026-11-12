import {Capacitor} from '@capacitor/core';
import NativeActivityDetail from './NativeActivityDetail.jsx';

// Activity details are a native iPhone screen. A browser (development only) has none.
export default function ActivityDetailScreen(props){
 if(Capacitor.getPlatform()==='ios')return <NativeActivityDetail {...props}/>;
 return <div className="notice"><p>Activity details are available in the iPhone app.</p><button type="button" className="secondary" onClick={props.onBack}>{props.backLabel||'Back to activities'}</button></div>;
}
