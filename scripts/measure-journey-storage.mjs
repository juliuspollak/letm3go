// Synthetic size estimate, not production telemetry or an iPhone benchmark.
// Run: node scripts/measure-journey-storage.mjs
import {emptyGrouping} from '../src/lib/journeyGrouping.js';
const id='d0000000-0000-4000-8000-000000000001',owner='99999999-9999-4999-8999-999999999999';
const metadata=emptyGrouping(owner);
metadata.titles[id]='Morning activity';metadata.enriched[id]=1800000000000;
metadata.roads[`${id}:1700000000:1700000300`]={version:2,status:'route',distanceMeters:1000,line:'a'.repeat(65536)};
for(let i=0;i<8;i++)metadata.places[`-34.${String(i).padStart(4,'0')},151.0000`]={source:'apple-geocoder-mapkit',candidates:[{name:'A saved place',placeID:'apple:'+i,category:'park',description:'p'.repeat(500)}]};
metadata.distanceSummaries[id]={pointCount:2000,recordedMeters:10000,summary:{estimatedMeters:11000,gaps:[]},presentation:{title:'Morning activity',location:'Start → End',tags:['park'],recognisedStops:[]}};
const bytes=value=>Buffer.byteLength(JSON.stringify(value));
const emptyBytes=bytes(emptyGrouping(owner)),perActivity=bytes(metadata)-emptyBytes;
const point={latitude:-34.123456,longitude:151.123456,timestamp:1700000000,accuracy:5,speed:4,altitude:10,segment:0};
const listRow={id,owner_id:owner,title:'Morning activity',activity:'Walking',recording_mode:'manual',started_at:'2026-11-08T00:00:00Z',ended_at:'2026-11-08T01:00:00Z',duration_seconds:3600,distance_meters:10000,vehicle:null,equipment:[],tags:[],collection:'',visibility:'private',revision:1,updated_at:'2026-11-08T01:00:00Z',route_points:null,point_count:2000,firstPoint:point,lastPoint:point};
const report={kind:'synthetic uncompressed JSON estimate; not observed user history',assumptions:{roadsPerActivity:1,encodedRoadBytes:65536,poiRecordsPerActivity:8,poiDescriptionBytes:500,gpsPointsPerActivity:2000,globalDownloadBefore:'journey metadata only; raw GPS separate',normalPageRoots:50,cacheActivities:200,cacheBytes:16*1024*1024,cacheExcludes:'pending writes, active context, unfinished enrichment, migration sources, essential control/work ledger; native originals remain safety archive'},measured:{perActivityMetadataBytes:perActivity,listRowBytes:bytes(listRow),fiftyRawSummaryRowsBytes:bytes(Array(50).fill(listRow)),oneRawGpsRouteBytes:bytes(Array(2000).fill(point))},estimates:[1000,5000,20000].map(activities=>({activities,previousFullMetadataBytes:emptyBytes+activities*perActivity,previousRawGpsIfFullyRestoredBytes:activities*bytes(Array(2000).fill(point)),newNormalPageRawSummaryBytes:bytes(Array(50).fill(listRow)),newOnDemandRawGpsPerOpenedRecordingBytes:bytes(Array(2000).fill(point))}))};
console.log(JSON.stringify(report,null,2));
