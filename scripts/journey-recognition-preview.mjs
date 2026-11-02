import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {buildJourneys,emptyGrouping,placeKey,internalStops} from '../src/lib/journeyGrouping.js';
import {recognitionSampleIndexes} from '../src/lib/journeyRecognition.js';
import {compareRoutes} from '../src/lib/journeyGeometry.js';

export function previewRecognition({owner,activities,metadata=emptyGrouping(owner),places=[]},providerRecords={}){
 if(!owner||metadata.owner!==owner||activities.some(t=>(t.ownerID||t.owner_id)&& (t.ownerID||t.owner_id)!==owner))throw new Error('Preview requires a single account owner.');
 const merged={...metadata,places:{...metadata.places,...providerRecords}};
 const context={owner,metadata:merged,places,vehicles:[],telemetry:[]};
 const model=buildJourneys(activities,context);
 const report={dryRun:true,queriesPerformed:0,activities:model.journeys.map(t=>({id:t.id,startedAt:t.startedAt,originalTitle:activities.find(a=>a.id===t.id)?.title,proposedTitle:t.title,
  proposedTags:t.tags,primary:t.recognition?.primary?.name||null,candidates:(t.recognition?.candidates||[]).map(({name,placeID,category,providerCategory,role,confidence,evidence,reason})=>({name,placeID,category,providerCategory,role,confidence,evidence,reason}))})),
  destinations:model.destinations,routeComparisons:[]};
 for(let i=0;i<activities.length;i++)for(let j=i+1;j<activities.length;j++)report.routeComparisons.push({ids:[activities[i].id,activities[j].id],...compareRoutes(activities[i],activities[j])});
 return report;
}
export function previewSamples({owner,activities,metadata=emptyGrouping(owner),places=[]}){
 const samples=new Map(),context={owner,metadata,places,vehicles:[],telemetry:[]};
 for(const trip of activities){
  if((trip.ownerID||trip.owner_id)&& (trip.ownerID||trip.owner_id)!==owner)throw new Error('Account changed.');
  for(const index of recognitionSampleIndexes(trip,internalStops(trip,context))){const p=trip.points[index],key=placeKey(p);if(key)samples.set(key,{key,latitude:p.latitude,longitude:p.longitude});}
 }
 return [...samples.values()];
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [inputPath,outputPath,providerPath]=process.argv.slice(2);
 if(!inputPath||!outputPath)throw new Error('Usage: node scripts/journey-recognition-preview.mjs private-input.json private-report.json [private-provider.json]');
 const input=JSON.parse(fs.readFileSync(inputPath,'utf8'));
 const records=providerPath?JSON.parse(fs.readFileSync(providerPath,'utf8')):{};
 const report=previewRecognition(input,records);
 fs.writeFileSync(outputPath,JSON.stringify(report,null,2),{mode:0o600});
 console.log(`Dry run: ${report.activities.length} activities, ${report.destinations.length} supported destinations. No activity or preference writes.`);
}
