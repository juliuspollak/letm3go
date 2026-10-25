// Local-only: validate an existing downloaded profile, install it and record verified metadata.
import{readFileSync,writeFileSync,mkdirSync,copyFileSync,lstatSync}from'node:fs';
import{spawnSync}from'node:child_process';
import path from'node:path';import os from'node:os';
import{releaseEnvironment}from'./testflight.mjs';
try{
 const source=process.argv[2];if(!source)throw new Error('Usage: node scripts/install-app-store-profile.mjs /path/to/downloaded.mobileprovision');
 const stat=lstatSync(source);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Profile must be a regular file.');
 const env=releaseEnvironment(process.cwd());if(env.APPLE_TEAM_ID!=='8YP6PFWVZ9')throw new Error('Apple team mismatch.');
 mkdirSync('.build/signing',{recursive:true});
 const decode=spawnSync('security',['cms','-D','-i',source],{encoding:'utf8'});if(decode.status!==0)throw new Error('Apple profile could not be decoded.');
 const plist='.build/signing/downloaded-profile.plist',report='.build/signing/verified-profile.json';writeFileSync(plist,decode.stdout,{mode:0o600});
 const checked=spawnSync('python3',['scripts/validate-profile.py',plist],{env:{...env,LETM3GO_PROFILE_REPORT:report},encoding:'utf8'});if(checked.status!==0)throw new Error(checked.stderr?.trim()||'App Store profile validation failed.');
 const profile=JSON.parse(readFileSync(report,'utf8'));if(!/^[A-F0-9-]{36}$/i.test(profile.uuid))throw new Error('Invalid profile identifier.');
 const destination=path.join(os.homedir(),'Library/Developer/Xcode/UserData/Provisioning Profiles');mkdirSync(destination,{recursive:true});copyFileSync(source,path.join(destination,profile.uuid+'.mobileprovision'));
 const file='.env.testflight.local',current=readFileSync(file,'utf8').split('\n').filter(line=>!/^\s*(?:export\s+)?PROFILE_(?:NAME|UUID)\s*=/.test(line)).join('\n').trimEnd();
 writeFileSync(file,current+'\nPROFILE_NAME='+JSON.stringify(profile.name)+'\nPROFILE_UUID='+JSON.stringify(profile.uuid)+'\n',{mode:0o600});
 console.log('Existing profile validated and installed. PROFILE_NAME and PROFILE_UUID now use verified metadata. No remote Apple changes.');
}catch(error){console.error(error.code?'Local profile setup failed; private configuration withheld.':error.message);process.exitCode=1;}
