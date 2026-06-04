#!/bin/bash
set -e

export ANDROID_HOME=/opt/android-sdk
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64

cd "$(dirname "$0")/android-app"
./gradlew clean assembleDebug
cp app/build/outputs/apk/debug/app-debug.apk ../PLAYD-debug.apk

echo "✅ PLAYD-debug.apk — $(ls -lh ../PLAYD-debug.apk | awk '{print $5}')"
