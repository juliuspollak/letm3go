"""Validate decoded Letm3go distribution profile without printing its contents."""
import datetime
import hashlib
import json
import os
import plistlib
import subprocess
import sys

with open(sys.argv[1], 'rb') as stream:
    profile = plistlib.load(stream)
def require(condition, message):
    if not condition:
        raise SystemExit(message)

team = os.environ['APPLE_TEAM_ID']
entitlements = profile.get('Entitlements', {})
require(profile['TeamIdentifier'] == [team], 'Profile team mismatch')
require(entitlements.get('com.apple.developer.applesignin') == ['Default'], 'Profile must authorize native Sign in with Apple')
require(entitlements.get('aps-environment') == 'production', 'App Store profile must authorize production push')
require(entitlements.get('application-identifier') == f'{team}.au.jpollak.journey', 'Profile is not for Letm3go')
require(not entitlements.get('get-task-allow', False), 'Development profile cannot distribute to TestFlight')
require(not profile.get('ProvisionedDevices') and not profile.get('ProvisionsAllDevices'), 'App Store profile required')
require(profile['ExpirationDate'] > datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None), 'Profile expired')
certificates = {hashlib.sha1(cert).hexdigest().upper() for cert in profile['DeveloperCertificates']}
identities = subprocess.check_output(['security', 'find-identity', '-v', '-p', 'codesigning', *([os.environ['LETM3GO_KEYCHAIN']] if os.environ.get('LETM3GO_KEYCHAIN') else [])], text=True)
require(any(digest in line and 'Apple Distribution:' in line for digest in certificates for line in identities.splitlines()), 'Imported signing identity is absent from profile')
for key in ['UUID', 'Name']:
    require('\n' not in profile[key] and '\r' not in profile[key], 'Invalid profile metadata')
if os.environ.get('GITHUB_ENV'):
    with open(os.environ['GITHUB_ENV'], 'a') as stream:
        stream.write(f'PROFILE_UUID={profile["UUID"]}\nPROFILE_NAME={profile["Name"]}\n')
if os.environ.get('LETM3GO_PROFILE_REPORT'):
    with open(os.environ['LETM3GO_PROFILE_REPORT'], 'w') as stream:
        json.dump({'uuid':profile['UUID'],'name':profile['Name'],'team':team,'appleSignIn':True,'push':'production'},stream)
print('Letm3go App Store profile, Apple Sign In, production push and installed signing identity validated.')
