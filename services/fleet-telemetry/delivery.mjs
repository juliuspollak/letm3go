import {normaliseFleetPayload,normaliseConnectivity} from '../../supabase/functions/_shared/fleetTelemetry.js';

export async function deliverFleetMessage({topic,partition,message},{send,reject,commit}){
 let event;
 try{
  const normalize=topic==='letm3go_connectivity'?normaliseConnectivity:normaliseFleetPayload;
  event=normalize(JSON.parse(message.value.toString('utf8')),message.key.toString('utf8'));
 }catch{
  // Kafka already holds the original frame. Keep only operational metadata in the rejection topic.
  await reject({reason:'invalid_receiver_frame',topic,partition,offset:message.offset});
 }
 if(event)await send({event});
 await commit([{topic,partition,offset:String(BigInt(message.offset)+1n)}]);
}
