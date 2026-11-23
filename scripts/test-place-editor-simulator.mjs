import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {cp,mkdtemp,rm,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
// Runs PlaceEditorUITests on an iPhone simulator against the real place editor and the live native map (tests/ui/place-editor).
//   node scripts/test-place-editor-simulator.mjs [-only-testing:AppUITests/PlaceEditorUITests/testName ...]
// PLACE_EDITOR_SIMULATOR: an xcodebuild destination. PLACE_EDITOR_SHOTS: a directory to keep a screenshot of every step in.
const root=process.cwd(),out=path.join(root,'.build/place-editor-web'),native=path.join(root,'ios/App/App/public');
const run=(args,env=process.env)=>{const r=spawnSync('caffeinate',['-i','xcodebuild',...args],{stdio:'inherit',env});if(r.status!==0)throw new Error(`xcodebuild exited ${r.status}`);};
const simctl=(...args)=>spawnSync('xcrun',['simctl',...args],{encoding:'utf8'});
function bootedPhone(){
 const devices=JSON.parse(simctl('list','devices','booted','--json').stdout);
 return Object.entries(devices.devices).filter(([runtime])=>runtime.includes('iOS')).flatMap(([,values])=>values).find(device=>device.state==='Booted');
}
let destination=process.env.PLACE_EDITOR_SIMULATOR;
if(!destination){
 let device=bootedPhone();
 if(!device){
  const available=JSON.parse(simctl('list','devices','available','--json').stdout);
  const phones=Object.entries(available.devices).filter(([runtime])=>runtime.includes('iOS')).flatMap(([,values])=>values).filter(entry=>entry.name.startsWith('iPhone'));
  device=phones.find(entry=>entry.name==='iPhone 17 Pro')||phones[0];
  if(!device)throw new Error('No iPhone simulator is installed.');
  simctl('boot',device.udid);
  const status=simctl('bootstatus',device.udid,'-b');
  if(status.status!==0)throw new Error('The simulator did not boot: '+status.stderr);
 }
 destination=`platform=iOS Simulator,id=${device.udid}`;
}
const common=['-project','ios/App/App.xcodeproj','-scheme','PlaceEditorUITests','-destination',destination,'-derivedDataPath','.build/place-editor-ios','-clonedSourcePackagesDirPath','.build/SourcePackages','CODE_SIGNING_ALLOWED=NO'];
await build({configFile:false,root:path.join(root,'tests/ui/place-editor'),base:'/',plugins:[react()],build:{outDir:out,emptyOutDir:true}});
const backup=await mkdtemp(path.join(root,'.build/place-editor-public-'));
await cp(native,backup,{recursive:true});
try{
 await rm(native,{recursive:true});await cp(out,native,{recursive:true});
 run([...common,'build-for-testing']);
}finally{
 // Whatever happened, the application's own web assets go back before anything else runs.
 await rm(native,{recursive:true,force:true});await cp(backup,native,{recursive:true});await rm(backup,{recursive:true});
}
const selection=process.argv.length>2?process.argv.slice(2):['-only-testing:AppUITests/PlaceEditorUITests'];
const products=path.join(root,'.build/place-editor-ios/Build/Products');
const manifests=(await readdir(products)).filter(name=>name.startsWith('PlaceEditorUITests_')&&name.endsWith('.xctestrun'));
if(manifests.length!==1)throw new Error('Expected one PlaceEditorUITests manifest in '+products);
const resultPath=path.join(root,`.build/place-editor-${Date.now()}.xcresult`);
const env={...process.env};
if(process.env.PLACE_EDITOR_SHOTS)env.TEST_RUNNER_PLACE_EDITOR_SHOTS=path.resolve(process.env.PLACE_EDITOR_SHOTS);
let failure=null;
try{
 run(['-xctestrun',path.join(products,manifests[0]),'-destination',destination,'-parallel-testing-enabled','NO','-resultBundlePath',resultPath,...selection,'test-without-building'],env);
}catch(error){failure=error;}
const summary=spawnSync('xcrun',['xcresulttool','get','test-results','summary','--path',resultPath],{encoding:'utf8'});
if(summary.status!==0)throw new Error('Could not inspect simulator test results: '+summary.stderr);
const result=JSON.parse(summary.stdout);
console.log(JSON.stringify({resultPath,totalTests:result.totalTestCount,passedTests:result.passedTests,failedTests:result.failedTests}));
if(failure||!result.totalTestCount||result.failedTests)throw failure||new Error('The place editor simulator tests did not all pass: '+resultPath);
