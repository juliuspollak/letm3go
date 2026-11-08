import {tagChoice} from './tagSearch.js';
import {commitNotice,tagLimitReached} from './tagMessaging.js';

// Adding a tag and remembering the destination are two independent writes with
// different lifetimes, and either one can fail on its own. Coordinating them is
// only about the two things a person can observe: nothing is reported as done that
// did not happen, and a failure never throws away the other half or the text that
// was typed. The place is saved first because it never edits the activity; the tag
// write only then has to be replayable, and a name the activity already carries is
// never written twice. There is no transaction on purpose: rolling back would
// delete work that succeeded.
// React (JourneyTags) and the native screen (through activityDetailsRequests) both
// call this, so the order, the retry behaviour and the sentence are identical.
export async function commitTagAndPlace({name,known=[],applied=[],custom=[],remember=false,canRemember=true,limit=20,addTag,savePlace}={}){
 const choice=tagChoice({known,applied,query:name});
 if(!choice.name)return {tag:'skipped',place:'skipped',name:'',clear:true,notice:''};
 // The tag limit is the only reason a press can do nothing: a name the trip already
 // carries is never added again, so it does not need room.
 if(!choice.applied&&custom.length>=limit)return {tag:'failed',place:'skipped',name:choice.name,clear:false,notice:tagLimitReached(limit)};
 const remembering=Boolean(remember&&canRemember);
 let place='skipped',reason='';
 if(remembering){
  try{await savePlace(choice.name);place='saved';}
  catch(error){place='failed';reason=error?.message||'';}
 }
 let tag=choice.applied?'applied':'skipped';
 if(!choice.applied){
  try{tag=(await addTag([...custom,choice.name]))?'added':'failed';}
  catch{tag='failed';}
 }
 // The typed name and the Remember tick survive any failure, so the half that did
 // not happen can be retried without retyping and without creating a duplicate.
 return {tag,place,name:choice.name,clear:tag!=='failed'&&place!=='failed',notice:commitNotice({tag,place,name:choice.name,reason})};
}
