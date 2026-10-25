// Restricted HMAC-authenticated gateway in front of Tesla's official signer.
import https from 'node:https';
import {readFile} from 'node:fs/promises';
import {verifyIngestion,FLEET_FIELDS} from '../../supabase/functions/_shared/fleetTelemetry.js';
const secret=process.env.FLEET_CONTROL_SECRET,host=process.env.FLEET_RECEIVER_HOST;
if(!secret||secret.length<32||!host)throw new Error('Signing gateway configuration missing');
const proxyCA=await readFile('/run/proxy-tls/cert.pem');const seen=new Map();
const server=https.createServer({cert:await readFile('/run/tls/fullchain.pem'),key:await readFile('/run/tls/privkey.pem')},async(req,res)=>{
 const finish=code=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({ok:code===200}));};
 if(req.method!=='POST'||req.url!=='/configure')return finish(404);
 try{
  let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>32000)return finish(413);}
  const signature=req.headers['x-lmg-signature'];if(!await verifyIngestion(body,req.headers['x-lmg-time'],signature,secret))return finish(401);
  if(seen.has(signature))return finish(409);seen.set(signature,Date.now());for(const [key,time] of seen)if(Date.now()-time>60000)seen.delete(key);
  const data=JSON.parse(body);
  if(!['configure','delete'].includes(data.action)||!/^[A-HJ-NPR-Z0-9]{17}$/.test(data.vin)||typeof data.accessToken!=='string'||data.accessToken.length>8192)return finish(400);
  if(data.action==='configure'&&(data.config?.hostname!==host||data.config?.port!==443||typeof data.config?.ca!=='string'||!data.config.ca.includes('BEGIN CERTIFICATE')))return finish(400);
  const configure=data.action==='configure',path=configure?'/api/1/vehicles/fleet_telemetry_config':`/api/1/vehicles/${data.vin}/fleet_telemetry_config`;
  const payload=configure?JSON.stringify({vins:[data.vin],config:{hostname:host,port:443,ca:data.config.ca,fields:FLEET_FIELDS}}):'';
  const result=await new Promise((resolve,reject)=>{
   const upstream=https.request({hostname:'command-proxy',port:4443,path,method:configure?'POST':'DELETE',ca:proxyCA,headers:{Authorization:`Bearer ${data.accessToken}`,'Content-Type':'application/json'},timeout:25000},response=>{
    let output='';response.on('data',chunk=>{output+=chunk;if(output.length>100000)upstream.destroy();});response.on('end',()=>{try{const parsed=JSON.parse(output);const skipped=parsed.response?.skipped_vehicles;const wasSkipped=skipped&&Object.values(skipped).some(v=>Array.isArray(v)&&v.includes(data.vin));resolve(response.statusCode>=200&&response.statusCode<300&&!parsed.error&&!wasSkipped&&(!configure||parsed.response?.updated_vehicles===1));}catch{resolve(false);}});
   });upstream.on('timeout',()=>upstream.destroy());upstream.on('error',reject);upstream.end(payload);
  });finish(result?200:502);
 }catch{finish(503);}
});
server.listen(8443,'0.0.0.0');
