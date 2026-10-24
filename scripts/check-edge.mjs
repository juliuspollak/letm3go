import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const directory=await mkdtemp(join(tmpdir(),'letm3go-edge-'));
try{
 await cp(resolve('supabase/functions'),directory,{recursive:true});
 execFileSync(resolve('node_modules/.bin/deno'),['check','--frozen','--node-modules-dir=none','--config','deno.json','journeys/index.ts','account/index.ts','tesla/index.ts'],{cwd:directory,stdio:'inherit'});
}finally{await rm(directory,{recursive:true,force:true});}
