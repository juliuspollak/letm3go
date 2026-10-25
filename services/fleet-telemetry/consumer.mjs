import {Kafka,logLevel} from 'kafkajs';
import {createHmac} from 'node:crypto';
import {normaliseFleetPayload,normaliseConnectivity} from '../../supabase/functions/_shared/fleetTelemetry.js';
const {FLEET_INGEST_SECRET:secret,FLEET_INGEST_URL:endpoint,KAFKA_BROKERS:brokers}=process.env;
if(!secret||secret.length<32||endpoint!=='https://subobfmlkfqcsaekygat.supabase.co/functions/v1/telemetry-ingest'||!brokers)throw new Error('Trusted telemetry consumer configuration missing');
const kafka=new Kafka({clientId:'letm3go-projection',brokers:brokers.split(','),logLevel:logLevel.NOTHING,retry:{initialRetryTime:1000,retries:5}});
const consumer=kafka.consumer({groupId:'letm3go-projection-v1'}),producer=kafka.producer(),admin=kafka.admin();
async function send(payload){
 const body=JSON.stringify(payload);
 for(let attempt=0;attempt<5;attempt++){
  const time=String(Date.now()),signature=createHmac('sha256',secret).update(`${time}.${body}`).digest('hex');
  try{const response=await fetch(endpoint,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','x-lmg-time':time,'x-lmg-signature':signature},body,signal:AbortSignal.timeout(30000)});if(response.ok)return;if(response.status<500&&response.status!==429)throw new Error('Ingestion rejected');}catch{/* No payload, VIN, location or secret is logged. */}
  await new Promise(r=>setTimeout(r,Math.min(30000,1000*2**attempt)));
 }
 throw new Error('Ingestion unavailable; Kafka offset retained');
}
await Promise.all([consumer.connect(),producer.connect(),admin.connect()]);
await consumer.subscribe({topics:['letm3go_V','letm3go_connectivity'],fromBeginning:true});
let heartbeatPending=false;
const heartbeat=setInterval(async()=>{if(heartbeatPending)return;heartbeatPending=true;try{const status=await fetch('http://receiver:8080/status',{signal:AbortSignal.timeout(5000)});const info=await admin.fetchTopicMetadata({topics:['letm3go_V']});await send({heartbeat:true,ready:status.ok&&info.topics.every(t=>t.partitions.length>0),version:'letm3go-fleet-v1'});}catch{/* Readiness becomes stale automatically. */}finally{heartbeatPending=false;}},30000);
consumer.on(consumer.events.CRASH,()=>{clearInterval(heartbeat);process.exit(1);});
await consumer.run({autoCommit:false,eachMessage:async({topic,partition,message})=>{
 let event;
 try{event=(topic==='letm3go_connectivity'?normaliseConnectivity:normaliseFleetPayload)(JSON.parse(message.value.toString('utf8')),message.key.toString('utf8'));}
 catch{await producer.send({topic:'letm3go_rejected',acks:-1,messages:[{value:JSON.stringify({reason:'invalid_receiver_frame',record:message.value.toString('base64')})}]});await consumer.commitOffsets([{topic,partition,offset:String(BigInt(message.offset)+1n)}]);return;}
 await send({event});await consumer.commitOffsets([{topic,partition,offset:String(BigInt(message.offset)+1n)}]);
}});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{clearInterval(heartbeat);await consumer.disconnect();await producer.disconnect();await admin.disconnect();process.exit(0);});
