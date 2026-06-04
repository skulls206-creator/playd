#!/bin/bash
# PLAYD Android APK Build Script
# Usage: ./build-apk.sh [debug|release]

set -e

BUILD_TYPE=${1:-debug}
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/artifacts/audio-player" && pwd)"
ANDROID_DIR="$PROJECT_DIR/android"

# Set environment
export ANDROID_HOME=/opt/android-sdk
export ANDROID_SDK_ROOT=/opt/android-sdk
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools

echo "🎵 Building PLAYD APK ($BUILD_TYPE)..."

# Build web assets
echo "📦 Building web assets..."
cd "$PROJECT_DIR"
pnpm build

# Sync to Android
echo "🔄 Syncing to Android..."
npx cap sync android

# Build APK
echo "🔨 Building APK..."
cd "$ANDROID_DIR"
if [ "$BUILD_TYPE" = "release" ]; then
    ./gradlew assembleRelease
    APK_PATH="app/build/outputs/apk/release/app-release-unsigned.apk"
    echo "⚠️  Release APK is unsigned. Sign it with jarsigner or use Android Studio."
else
    ./gradlew assembleDebug
    APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
fi

# Copy to project root
OUTPUT_NAME="PLAYD-${BUILD_TYPE}.apk"
cp "$ANDROID_DIR/$APK_PATH" "$(dirname "${BASH_SOURCE[0]}")/$OUTPUT_NAME"

echo "✅ Build complete!"
echo "📱 APK: $(dirname "${BASH_SOURCE[0]}")/$OUTPUT_NAME"
echo "📏 Size: $(ls -lh "$(dirname "${BASH_SOURCE[0]}")/$OUTPUT_NAME" | awk '{print $5}')"
