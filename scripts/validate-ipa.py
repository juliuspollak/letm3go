"""Validate a signed Letm3go App Store IPA without uploading or printing credentials."""
import datetime,hashlib,json,pathlib,plistlib,subprocess,sys,tempfile,zipfile
ipa=pathlib.Path(sys.argv[1])
def require(value,message):
    if not value: raise SystemExit(message)
with zipfile.ZipFile(ipa) as archive:
    infos=[name for name in archive.namelist() if name.startswith('Payload/') and name.count('/')==2 and name.endswith('.app/Info.plist')]
    require(len(infos)==1,'Expected one iOS application')
    prefix=infos[0][:-len('Info.plist')]
    info=plistlib.loads(archive.read(infos[0]))
    require(info.get('CFBundleIdentifier')=='au.jpollak.journey','IPA bundle ID mismatch')
    with tempfile.TemporaryDirectory() as directory:
        provision=pathlib.Path(directory)/'profile.mobileprovision'
        provision.write_bytes(archive.read(prefix+'embedded.mobileprovision'))
        decoded=subprocess.run(['security','cms','-D','-i',str(provision)],capture_output=True,check=True)
        profile=plistlib.loads(decoded.stdout);e=profile.get('Entitlements',{})
        require(profile['ExpirationDate']>datetime.datetime.utcnow(),'Distribution profile expired')
        for name in archive.namelist():
            require(not pathlib.PurePosixPath(name).is_absolute() and '..' not in pathlib.PurePosixPath(name).parts,'Unsafe IPA entry')
        archive.extractall(directory)
        app=pathlib.Path(directory)/prefix
        subprocess.run(['codesign','--verify','--deep','--strict',str(app)],capture_output=True,check=True)
        entitlements=subprocess.run(['codesign','-d','--entitlements',':-',str(app)],capture_output=True,check=True)
        signed=plistlib.loads(entitlements.stdout)
        require(not signed.get('get-task-allow'),'Debug entitlement in distribution app')
        require(signed.get('com.apple.developer.applesignin')==['Default'],'Signed Apple entitlement missing')
        require(signed.get('aps-environment')=='production','Signed production push entitlement missing')
        require(signed.get('application-identifier')=='8YP6PFWVZ9.au.jpollak.journey','Signed application identifier mismatch')
        # The embedded Apple Watch app carries its own App Store signature.
        watch_apps=sorted((app/'Watch').glob('*.app'))
        require(len(watch_apps)==1,'Expected one embedded Apple Watch app')
        watch_signed=plistlib.loads(subprocess.run(['codesign','-d','--entitlements',':-',str(watch_apps[0])],capture_output=True,check=True).stdout)
        require(watch_signed.get('application-identifier')=='8YP6PFWVZ9.au.jpollak.journey.watchkitapp','Signed Apple Watch application identifier mismatch')
        require(not watch_signed.get('get-task-allow'),'Debug entitlement in distribution Apple Watch app')
        require(watch_signed.get('com.apple.developer.healthkit') is True,'Signed Apple Watch HealthKit entitlement missing')
        require(not e.get('get-task-allow') and not profile.get('ProvisionedDevices') and not profile.get('ProvisionsAllDevices'),'App Store distribution profile required')
        require(e.get('com.apple.developer.applesignin')==['Default'],'Apple Sign In missing')
        require(e.get('aps-environment')=='production','Production push profile entitlement missing')
        require(e.get('application-identifier')=='8YP6PFWVZ9.au.jpollak.journey','Wrong signing team/application')
    config=json.loads(archive.read(prefix+'capacitor.config.json'))
    require(config.get('appId')=='au.jpollak.journey' and not config.get('server'),'Development server is forbidden in IPA')
    require(prefix+'public/index.html' in archive.namelist(),'Bundled web app missing')
    require('location' in info.get('UIBackgroundModes',[]),'Background location capability missing')
    commit=info.get('Letm3goCommit','')
    require(commit and not commit.startswith('$('),'Build commit identifier missing: build through the fastlane package lane')
report={'bundleID':info['CFBundleIdentifier'],'version':info['CFBundleShortVersionString'],'build':info['CFBundleVersion'],'commit':commit,'sha256':hashlib.sha256(ipa.read_bytes()).hexdigest()}
manifest=ipa.with_suffix('.manifest.json')
if manifest.exists(): require(json.loads(manifest.read_text())==report,'IPA no longer matches its reviewed manifest')
else: manifest.write_text(json.dumps(report,indent=2))
print('App Store IPA identity, profile, Apple Sign In, background location, bundled assets and manifest verified.')
