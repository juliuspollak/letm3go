import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('./ActivityPrivacy.jsx',()=>({default:()=>null}));
vi.mock('./JourneyMap.jsx',()=>({default:({embeddedEnabled=true})=><div aria-label={embeddedEnabled?'Interactive Apple map':'Static map preview'}/>}));
import ActivityDetail from './ActivityDetail.jsx';
import {recordedJourney} from '../lib/recorder.js';
afterEach(cleanup);
const trip=recordedJourney({id:'drive',activity:'Driving',state:'finished',source:'device',recordingMode:'automatic',startedAt:1000,endedAt:1100,distanceMeters:1000,durationSeconds:100,points:[{latitude:1,longitude:2,timestamp:1000,segment:0},{latitude:3,longitude:4,timestamp:1100,segment:0}]});
it('shows an interactive Apple map directly on trip details',()=>{
 render(<ActivityDetail trip={trip}/>);
 expect(screen.getByLabelText('Interactive Apple map')).toBeInTheDocument();
 expect(screen.queryByLabelText('Static map preview')).not.toBeInTheDocument();
});
it('explains that only the same activity continues a published stop',()=>{
 render(<ActivityDetail trip={{...trip,provisional:true,continuationEndsAt:Date.now()/1000+600}}/>);
 const notice=screen.getByRole('status');
 expect(notice).toHaveTextContent('Stopped and saved to History');
 expect(notice).toHaveTextContent('10 minutes remain for the same activity near here');
 expect(notice).toHaveTextContent('A different activity (walking after parking, or driving after a walk) is saved as its own journey.');
});
it('lets an unfinished automatic drive be viewed without offering edits to a finished-only native record',()=>{
 render(<ActivityDetail trip={{...trip,state:'recording',endedAt:null}}/>);
 expect(screen.getByRole('status')).toHaveTextContent('Automatic recording in progress');
 expect(screen.getByLabelText('Interactive Apple map')).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Edit activity'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Delete activity'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Save visible route'})).not.toBeInTheDocument();
});
