import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {cp,mkdtemp,rm,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const root=process.cwd(),out=path.join(root,'.build/activity-scroll-web'),native=path.join(root,'ios/App/App/public');
const backup=await mkdtemp(path.join(root,'.build/activity-scroll-public-'));
const run=args=>{const r=spawnSync('caffeinate',['-i','xcodebuild',...args],{stdio:'inherit'});if(r.status!==0)throw new Error(`xcodebuild exited ${r.status}`);};
const devices=JSON.parse(spawnSync('xcrun',['simctl','list','devices','booted','--json'],{encoding:'utf8'}).stdout);
const booted=Object.entries(devices.devices).filter(([runtime])=>runtime.includes('iOS')).flatMap(([,values])=>values).find(device=>device.state==='Booted');
if(!process.env.SCROLL_SIMULATOR&&!booted)throw new Error('Boot an iPhone simulator or set SCROLL_SIMULATOR to an xcodebuild destination.');
const destination=process.env.SCROLL_SIMULATOR||`platform=iOS Simulator,id=${booted.udid}`;
const common=['-project','ios/App/App.xcodeproj','-scheme','ActivityScrollUITests','-destination',destination,'-derivedDataPath','.build/activity-scroll-ios','-clonedSourcePackagesDirPath','.build/SourcePackages','CODE_SIGNING_ALLOWED=NO'];
await build({configFile:false,root:path.join(root,'tests/ui/activity-scroll'),base:'/',plugins:[react()],build:{outDir:out,emptyOutDir:true}});
await cp(native,backup,{recursive:true});
try{
 await rm(native,{recursive:true});await cp(out,native,{recursive:true});
 run([...common,'build-for-testing']);
}finally{
 await rm(native,{recursive:true});await cp(backup,native,{recursive:true});await rm(backup,{recursive:true});
}
const selection=process.argv.length>2?process.argv.slice(2):[
 '-only-testing:AppUITests/ActivityScrollUITests',
 '-only-testing:AppUITests/ActivityDetailsUITests/testScrollingHandsOverBetweenPanelAndContent',
 '-only-testing:AppUITests/ActivityDetailsUITests/testScrollingBackToTheTopSettles'];
// Multiple schemes share a test target. Use this scheme's compiled manifest
// explicitly, otherwise Xcode can select stale discovery information and run zero tests.
const products=path.join(root,'.build/activity-scroll-ios/Build/Products');
const manifests=(await readdir(products)).filter(name=>name.startsWith('ActivityScrollUITests_')&&name.endsWith('.xctestrun'));
if(manifests.length!==1)throw new Error('Expected one ActivityScrollUITests manifest in '+products);
const resultPath=path.join(root,`.build/activity-scroll-${Date.now()}.xcresult`);
run(['-xctestrun',path.join(products,manifests[0]),'-destination',destination,
 '-parallel-testing-enabled','NO','-resultBundlePath',resultPath,...selection,'test-without-building']);
const summary=spawnSync('xcrun',['xcresulttool','get','test-results','summary','--path',resultPath],{encoding:'utf8'});
if(summary.status!==0)throw new Error('Could not inspect simulator test results: '+summary.stderr);
const result=JSON.parse(summary.stdout);
if(!result.totalTestCount||!result.passedTests)throw new Error('Simulator ran no passing tests: '+resultPath);
console.log(JSON.stringify({resultPath,totalTests:result.totalTestCount,passedTests:result.passedTests,failedTests:result.failedTests}));
