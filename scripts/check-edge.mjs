import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const directory=await mkdtemp(join(tmpdir(),'letm3go-edge-'));
try{
 await cp(resolve('supabase/functions'),directory,{recursive:true});
 const deno=resolve(process.platform==='win32'?'node_modules/deno/deno.exe':'node_modules/.bin/deno');
 execFileSync(deno,['check','--frozen','--node-modules-dir=none','--config','deno.json','health/index.ts','journeys/index.ts','account/index.ts','tesla/index.ts','tesla-recording/index.ts','telemetry-ingest/index.ts','send-push-notifications/index.ts'],{cwd:directory,stdio:'inherit',windowsHide:true});
}finally{await rm(directory,{recursive:true,force:true});}
