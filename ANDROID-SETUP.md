# PLAYD Android Setup

## Prerequisites

- Java 21 (OpenJDK)
- Android SDK (installed at `/opt/android-sdk`)
- Node.js 18+
- pnpm

## Quick Build

```bash
./build-apk.sh debug
```

This will:
1. Build the web assets (`pnpm build`)
2. Sync to Android project (`npx cap sync android`)
3. Build the debug APK
4. Copy `PLAYD-debug.apk` to the project root

## Manual Build

```bash
# Build web assets
cd artifacts/audio-player
pnpm build

# Sync to Android
npx cap sync android

# Build APK
cd android
export ANDROID_HOME=/opt/android-sdk
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
./gradlew assembleDebug
```

## APK Location

- Debug: `android/app/build/outputs/apk/debug/app-debug.apk`
- Release: `android/app/build/outputs/apk/release/app-release-unsigned.apk`

## Signing Release APK

For Play Store distribution, you need to sign the release APK:

```bash
# Generate keystore (one-time)
keytool -genkey -v -keystore playd-release.keystore \
  -alias playd -keyalg RSA -keysize 2048 -validity 10000

# Sign APK
jarsigner -verbose -sigalg SHA256withRSA -digestalg SHA-256 \
  -keystore playd-release.keystore \
  app/build/outputs/apk/release/app-release-unsigned.apk playd

# Zipalign
$ANDROID_HOME/build-tools/34.0.0/zipalign -v 4 \
  app-release-unsigned.apk PLAYD-release.apk
```

## Permissions

The app requests these permissions:
- `INTERNET` — Network access
- `READ_EXTERNAL_STORAGE` / `READ_MEDIA_AUDIO` — Read music files
- `WAKE_LOCK` — Keep screen on during playback
- `FOREGROUND_SERVICE` / `FOREGROUND_SERVICE_MEDIA_PLAYBACK` — Background audio
- `POST_NOTIFICATIONS` — Media controls notification
- `RECEIVE_BOOT_COMPLETED` — Resume playback after reboot
- `VIBRATE` — Haptic feedback

## Plugins

Installed Capacitor plugins:
- `@capacitor/app` — App lifecycle
- `@capacitor/filesystem` — File access
- `@capacitor/haptics` — Haptic feedback
- `@capacitor/keyboard` — Keyboard management
- `@capacitor/local-notifications` — Local notifications
- `@capacitor/splash-screen` — Splash screen
- `@capacitor/status-bar` — Status bar styling

## Configuration

Main config: `capacitor.config.ts`

- App ID: `com.playd.music`
- App Name: `PLAYD`
- Web Dir: `dist/public`
- Android Scheme: `https`

## Notes

- The app is a WebView wrapper around the PWA
- All audio processing happens in the WebView
- IndexedDB is used for local storage (same as web version)
- File access requires user permission on Android 13+
