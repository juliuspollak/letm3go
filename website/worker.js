const ORIGIN='https://letm3go.au';
const CALLBACK='/auth/tesla/callback';
const BACKEND='https://subobfmlkfqcsaekygat.supabase.co/functions/v1/tesla';
const KEY='/.well-known/appspecific/com.tesla.3p.public-key.pem';
const outcomes=new Set(['setup_required','invalid','expired','account_deleting','cancelled','failed','connected']);
function secure(response,{sensitive=false}={}){
 const headers=new Headers(response.headers);
 headers.set('X-Content-Type-Options','nosniff');
 headers.set('Referrer-Policy','no-referrer');
 headers.set('Strict-Transport-Security','max-age=31536000');
 headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
 headers.set('Content-Security-Policy',"default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
 if(sensitive)headers.set('Cache-Control','no-store');
 return new Response(response.body,{status:response.status,headers});
}
function plain(message,status=400){return secure(new Response(message,{status,headers:{'Content-Type':'text/plain; charset=utf-8'}}),{sensitive:true});}
async function callback(request,fetcher){
 const url=new URL(request.url);
 if(url.search.length>6000)return plain('Invalid Tesla callback. Return to Letm3go and reconnect.');
 const params=url.searchParams;
 if(['code','state','error'].some(key=>params.getAll(key).length>1))return plain('Invalid Tesla callback.');
 const state=params.get('state'),code=params.get('code'),error=params.get('error');
 if(!state||! /^[a-f0-9]{64}$/.test(state)||(!code&&!error)||(code&&error)||code?.length>4000||error?.length>100)return plain('Start the Tesla connection from Garage in the Letm3go iPhone app.');
 const target=new URL(BACKEND);
 target.searchParams.set('state',state);
 if(error)target.searchParams.set('error',error);else target.searchParams.set('code',code);
 try{
  // Never forward browser cookies/headers; never log the request URL or response.
  // Supabase owns state consumption, owner checks and server-side token exchange.
  const result=await fetcher(target.href,{method:'GET',redirect:'manual',headers:{Accept:'application/json'},signal:AbortSignal.timeout(25000)});
  const location=result.headers.get('Location');
  if(result.status!==302||!location)return plain('Tesla connection is unavailable. Return to Letm3go and retry.',503);
  const next=new URL(location);
  if(next.protocol!=='au.jpollak.journey:'||next.hostname!=='tesla'||next.pathname!=='/connected'||next.username||next.password||next.port||next.hash||next.searchParams.size!==1||!outcomes.has(next.searchParams.get('status')))return plain('Tesla connection could not be confirmed. Return to Letm3go.',502);
  // Only a fixed status returns to iOS, never codes or tokens.
  return secure(new Response(null,{status:302,headers:{Location:next.href}}),{sensitive:true});
 }catch{return plain('Tesla connection is unavailable. Return to Letm3go and retry.',503);}
}
export function makeHandler(fetcher=fetch){return async function(request,env){
 const url=new URL(request.url);
 const local=['localhost','127.0.0.1'].includes(url.hostname);
 if(!['letm3go.au','www.letm3go.au'].includes(url.hostname)&&!local)return plain('Unknown host.',421);
 const sensitive=url.pathname===CALLBACK;
 // Do not bounce OAuth credentials between hosts or from an insecure URL.
 if(sensitive&&(url.protocol!=='https:'||url.hostname!=='letm3go.au')&&!local)return plain('Use the registered HTTPS Tesla callback on letm3go.au.');
 if(!local&&(url.protocol!=='https:'||url.hostname==='www.letm3go.au'))return secure(new Response(null,{status:308,headers:{Location:ORIGIN+url.pathname}}),{sensitive:true});
 if(!['GET','HEAD'].includes(request.method))return secure(new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}}),{sensitive:true});
 if(sensitive){if(request.method==='HEAD')return plain('Start Tesla connection from the iPhone app.');return callback(request,fetcher);}
 if(url.pathname===KEY){
  const result=await env.ASSETS.fetch(new Request(new URL(KEY,ORIGIN),{method:'GET'}));
  if(result.status!==200)return plain('Tesla public key is not configured.',503);
  const pem=await result.text();
  if(!/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\s*$/.test(pem))return plain('Tesla public key is not configured.',503);
  try{const encoded=pem.replace(/-----[^-]+-----|\s/g,'');const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));await crypto.subtle.importKey('spki',bytes,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);}catch{return plain('Tesla public key is not configured.',503);}
  return secure(new Response(request.method==='HEAD'?null:pem,{headers:{'Content-Type':'application/x-pem-file','Cache-Control':'public, max-age=300'}}));
 }
 if(!['/','/styles.css','/brand.svg','/favicon.svg','/robots.txt'].includes(url.pathname))return plain('Page not found.',404);
 // Ignore arbitrary query strings; never forward them into asset request logs.
 const asset=new Request(new URL(url.pathname,ORIGIN),{method:request.method});
 return secure(await env.ASSETS.fetch(asset));
};}
export default {fetch:makeHandler()};
