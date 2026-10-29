// Computes the Map overview off the main thread (see useMapOverview). Its
// per-journey edge cache and last results live here between requests.
import {mapOverview} from './mapOverview.js';
import {unpackJourneys} from './overviewTransfer.js';

self.onmessage=({data})=>{
 try{
  const overview=mapOverview(unpackJourneys(data),{unit:data.unit});
  self.postMessage({id:data.id,overview});
 }catch(error){
  self.postMessage({id:data.id,error:String(error?.message||error)});
 }
};
