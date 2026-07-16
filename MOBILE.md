# RigRout mobile apps

RigRout uses Capacitor to package the existing UI for Android and iOS. The UI
is bundled into each app; live alerts, feedback, incidents, and route planning
connect to the deployed RigRout server.

## Configure the backend

The default backend is `https://rigrout.com`. Override
`MOBILE_API_BASE` before synchronizing if the API moves to another origin:

```powershell
$env:MOBILE_API_BASE = 'https://staging.rigrout.com'
npm run mobile:sync
```

On the server, allow the two Capacitor WebView origins:

```text
ALLOWED_ORIGINS=capacitor://localhost,http://localhost
```

Do not put TomTom, DOT, or admin keys in `MOBILE_API_BASE` or in native files.
Those secrets remain server-side.

## Android

Install Android Studio and its current SDK, then run:

```powershell
npm run mobile:android
```

Use Android Studio to create a signed App Bundle (`.aab`) for Google Play.

## iOS

Synchronize the project on any machine with `npm run mobile:sync`. Opening,
signing, archiving, and App Store submission require macOS with Xcode:

```bash
npm run mobile:ios
```

Choose your Apple developer team and unique bundle identifier before archiving.
