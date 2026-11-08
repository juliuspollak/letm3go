// The existing private backup RPC preserves classification JSONB verbatim. Keep
// stop annotations in a versioned envelope there: view_metadata has a strict
// allowlist and cannot carry them without a migration. Never back up transient
// evidence/provisional state. Route segment boundaries remain authoritative.
const KEY='journeyStops',PRIVATE='privateActivity';
const PRIVATE_FIELDS=['heartRate','energy','wholeWorkoutEnergy','energyBinding','indoor','mtbTrailID','mtbTrailName','mtbSegmentID','mtbTrailDistanceMeters','routeQuality','titleEdited','trackingNotes','classificationDistances','recordingPrecision','sourceUpdatedAt'];
const MAX_STOPS=1024;
const verdicts=new Set(['temporaryPause','meaningfulDestination','ambiguous']);
const confidences=new Set(['low','medium','high']);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
function interval(value,start,end,destination=false){
 if(!object(value)||!Number.isFinite(value.start)||!Number.isFinite(value.end)||value.start<start||value.start>end||value.end<value.start||(!destination&&value.end>end))return undefined;
 const result={start:value.start,end:value.end};
 if(verdicts.has(value.verdict))result.verdict=value.verdict;
 if(confidences.has(value.confidence))result.confidence=value.confidence;
 if(Array.isArray(value.reasons))result.reasons=value.reasons.filter(reason=>typeof reason==='string').slice(0,8).map(reason=>reason.slice(0,300));
 return result;
}
function annotations(value,start,end){
 const result={};
 if(Array.isArray(value?.stops)){
  const stops=value.stops.slice(-MAX_STOPS).map(stop=>interval(stop,start,end)).filter(Boolean);
  if(stops.length)result.stops=stops;
 }
 const destination=interval(value?.destinationStop,start,end,true);
 if(destination)result.destinationStop=destination;
 return result;
}
export function backupClassification(details,start,end){
 const classification=object(details?.classification)?{...details.classification}:{predicted:'Unknown',confidence:'low',evidence:[]};
 delete classification[KEY];delete classification[PRIVATE];
 const privateFields=Object.fromEntries(PRIVATE_FIELDS.filter(key=>details?.[key]!==undefined).map(key=>[key,details[key]]));
 if(Object.keys(privateFields).length)classification[PRIVATE]={version:1,...privateFields};
 const stops=annotations(details,start,end);
 if(Object.keys(stops).length)classification[KEY]={version:1,...stops};
 return classification;
}
export function restoreClassification(raw,start,end){
 const classification=object(raw)?{...raw}:{predicted:'Unknown',confidence:'low',evidence:[]};
 const envelope=classification[KEY],stored=classification[PRIVATE];
 const privateFields=stored?.version===1?Object.fromEntries(PRIVATE_FIELDS.filter(key=>stored[key]!==undefined).map(key=>[key,stored[key]])):{};
 delete classification[KEY];delete classification[PRIVATE];
 return {classification,...privateFields,...(object(envelope)&&envelope.version===1?annotations(envelope,start,end):{})};
}
