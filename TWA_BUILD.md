# Transchat Android TWA Build

## Current readiness

- App name: `Transchat`
- Package ID: `com.transchat.chat`
- Web origin: `https://transchat.xyz`
- Web manifest: `https://transchat.xyz/manifest.json`
- Digital Asset Links path: `https://transchat.xyz/.well-known/assetlinks.json`

The current web app is suitable for a Bubblewrap-based Trusted Web Activity because it already has:

- an installable web manifest
- HTTPS origin
- icons
- a registered service worker
- a single primary origin

## Local prerequisites

Install these on the machine that will build the existing Android project and bundle:

1. Node.js 20+
2. Java JDK 17
3. Android Studio with Android SDK and platform tools
4. `adb`, `keytool`, and SDK tools available on `PATH`

Then verify:

```powershell
npm run twa:doctor
```

## 1. Generate the upload keystore

```powershell
keytool -genkeypair -v -keystore transchat-upload.keystore -alias transchat -keyalg RSA -keysize 2048 -validity 10000
```

Check the SHA-256 fingerprint:

```powershell
keytool -list -v -keystore transchat-upload.keystore -alias transchat
```

## 2. Android project status

This repository already contains the generated Android Gradle project at the repository root.

That means these files should already exist in the current folder:

- `app/`
- `gradle/`
- `gradlew`
- `gradlew.bat`
- `build.gradle`
- `settings.gradle`
- `twa-manifest.json`

If those files are present, do not run Bubblewrap again just to build the `.aab`.

## 3. Update Digital Asset Links

Generate the statement file:

```powershell
npm run assetlinks:generate -- --package com.transchat.chat --fingerprint "SHA256:AA:BB:CC:..."
```

This updates:

- `.well-known/assetlinks.json`

For Play Console internal testing, the final fingerprint should be the **Play App Signing certificate SHA-256** from Play Console.

If you first test a local or manually installed build, you can temporarily use the upload keystore fingerprint.

## 4. Deploy the asset links file

Start the local server and verify:

```powershell
node server.mjs
```

Open:

- `http://localhost:3000/.well-known/assetlinks.json`

Then deploy the same file so this URL works in production:

- `https://transchat.xyz/.well-known/assetlinks.json`

## 5. Refresh the Android project after asset links changes

```powershell
npm run twa:update
```

Skip this step if Bubblewrap is not installed and the current root Gradle project is already in place.

## 6. Build the Android App Bundle

```powershell
npm run twa:build
```

Expected output:

- `app/build/outputs/bundle/release/app-release.aab`

## 7. Upload to Google Play Console

Use the `.aab` file for:

- Internal testing track

Required Play Console items before wider release:

- App signing enabled
- version code / version name checked
- app icon
- screenshots
- app description
- privacy policy URL
- data safety form
- test account notes if login is required

## Important note about fingerprint choice

For testers installing from Google Play, `assetlinks.json` should contain the **Play App Signing** certificate fingerprint, not only the upload certificate fingerprint.

Recommended order:

1. Create the app in Play Console
2. Enable Play App Signing
3. Read the App Signing SHA-256 fingerprint from Play Console
4. Regenerate `.well-known/assetlinks.json`
5. Deploy it to `https://transchat.xyz/.well-known/assetlinks.json`
6. Upload the release `.aab`

## Bubblewrap fallback

If Bubblewrap cannot be used because of environment/tooling constraints, the fallback is an Android WebView wrapper app.

Use WebView fallback only if:

- the origin cannot pass Digital Asset Links verification
- the site must open multiple unrelated origins
- local Android tooling remains blocked

For the current Transchat setup, Bubblewrap/TWA is the preferred path.
