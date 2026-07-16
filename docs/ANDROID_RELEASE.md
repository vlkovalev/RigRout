# RigRout Android release handoff

## Current release

- Application ID: `com.rigrout.app`
- Version name: `1.1.0`
- Version code: `2`
- Privacy policy: `https://rigrout.com/privacy`
- Release artifact: `android/app/build/outputs/bundle/release/app-release.aab`

Every Play Store upload must use a version code greater than the previous upload.

## One-time upload key

Create and back up the upload key. Do not commit the key or its passwords.

```powershell
keytool -genkeypair -v -keystore "$HOME\rigrout-upload.jks" -alias rigrout-upload -keyalg RSA -keysize 2048 -validity 10000
```

Set the four variables only in the terminal used for the release build:

```powershell
$env:RIGROUT_KEYSTORE_FILE="$HOME\rigrout-upload.jks"
$env:RIGROUT_KEYSTORE_PASSWORD="your-keystore-password"
$env:RIGROUT_KEY_ALIAS="rigrout-upload"
$env:RIGROUT_KEY_PASSWORD="your-key-password"
npm.cmd run mobile:sync
Push-Location android
.\gradlew.bat bundleRelease
Pop-Location
```

For the standard local key location above, the repository also includes a safe
interactive builder. It prompts invisibly for the password, verifies the final
bundle signature, and clears signing variables when finished:

```powershell
npm.cmd run mobile:release:android
```

Enroll in Google Play App Signing when creating the Play Console app. Google protects the app-signing key; this local key is the upload key. Keep an offline backup.

## Play Console data-safety answers

Verify these answers against the production configuration when submitting:

- Location: collected only when the user invokes GPS/location functionality; app functionality purpose; not used in the background.
- User content: feedback and community hazard text may be collected; app functionality and support purposes.
- App activity/settings: route and vehicle preferences are primarily stored on-device.
- Data sale: no.
- Data shared: network requests go to mapping, routing, traffic, weather, and public-data providers as required to provide app functionality.
- Deletion request mechanism: the in-app Feedback feature, as described in the privacy policy.
- Data encrypted in transit: yes; production endpoints must remain HTTPS-only.

## Before production submission

1. Confirm `https://rigrout.com/privacy` is live.
2. Build the signed `.aab` and upload it to Play Console internal testing.
3. Install the Play-delivered internal-test build; do not rely only on a locally installed debug APK.
4. Test GPS permission denial/approval, a long Canada-US route, all selected layers, app restart, and offline/server-unavailable warnings.
5. Capture phone screenshots from the internal-test build for the store listing.
