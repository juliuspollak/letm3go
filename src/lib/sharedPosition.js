import {recorder,recorderAvailable} from './recorder.js';
export async function sharedPosition(){
 if(!recorderAvailable())throw new Error('Location sharing is available in the iPhone app.');
 const fix=await recorder.currentPosition();
 if(!Number.isFinite(fix?.latitude)||!Number.isFinite(fix?.longitude)||Math.abs(fix.latitude)>90||Math.abs(fix.longitude)>180||!Number.isFinite(fix?.accuracy)||fix.accuracy<0||fix.accuracy>100||!Number.isFinite(fix.timestamp)||Math.abs(Date.now()/1000-fix.timestamp)>30)throw new Error('We need a recent, accurate position to share your location. Check location access and try again.');
 return fix;
}
