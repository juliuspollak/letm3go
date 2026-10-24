"""Validate decoded Letm3go distribution profile without printing its contents."""
import datetime
import hashlib
import os
import plistlib
import subprocess
import sys

with open(sys.argv[1], 'rb') as stream:
    profile = plistlib.load(stream)
team = os.environ['APPLE_TEAM_ID']
entitlements = profile.get('Entitlements', {})
assert profile['TeamIdentifier'] == [team], 'Profile team mismatch'
assert entitlements.get('com.apple.developer.applesignin') == ['Default'], 'Profile must authorize native Sign in with Apple'
assert entitlements.get('application-identifier') == f'{team}.au.jpollak.journey', 'Profile is not for Letm3go'
assert not entitlements.get('get-task-allow', False), 'Development profile cannot distribute to TestFlight'
assert not profile.get('ProvisionedDevices') and not profile.get('ProvisionsAllDevices'), 'App Store profile required'
assert profile['ExpirationDate'] > datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None), 'Profile expired'
certificates = {hashlib.sha1(cert).hexdigest().upper() for cert in profile['DeveloperCertificates']}
identities = subprocess.check_output(['security', 'find-identity', '-v', '-p', 'codesigning', os.environ['LETM3GO_KEYCHAIN']], text=True)
assert any(digest in identities for digest in certificates), 'Imported signing identity is absent from profile'
for key in ['UUID', 'Name']:
    assert '\n' not in profile[key] and '\r' not in profile[key], 'Invalid profile metadata'
with open(os.environ['GITHUB_ENV'], 'a') as stream:
    stream.write(f'PROFILE_UUID={profile["UUID"]}\nPROFILE_NAME={profile["Name"]}\n')
print('Letm3go distribution profile and signing identity validated.')
