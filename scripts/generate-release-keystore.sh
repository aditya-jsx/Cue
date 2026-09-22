#!/usr/bin/env bash
set -euo pipefail

# Generates an Android Release Keystore for Solana dApp Store publishing.
# Complies with guidelines in solana-mobile-publishing:
# 1. 2048-bit RSA key, validity 10000 days.
# 2. Keystore stored outside git repo by default (~/.android/cue-release.keystore).

DEFAULT_KEYSTORE_PATH="$HOME/.keystores/cue-release.keystore"
KEYSTORE_PATH="${1:-$DEFAULT_KEYSTORE_PATH}"
ALIAS="cue-release-key"

echo "================================================================="
echo "  Cue Android Release Keystore Generator"
echo "  Target Path: $KEYSTORE_PATH"
echo "  Key Alias:   $ALIAS"
echo "================================================================="

if [ -f "$KEYSTORE_PATH" ]; then
  echo "Keystore already exists at $KEYSTORE_PATH."
  echo "Skipping key generation to avoid overwriting existing key."
else
  mkdir -p "$(dirname "$KEYSTORE_PATH")"
  echo "Generating keystore with keytool..."
  keytool -genkeypair -v \
    -keystore "$KEYSTORE_PATH" \
    -alias "$ALIAS" \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -storetype PKCS12
  echo "Keystore created successfully at: $KEYSTORE_PATH"
fi

echo ""
echo "To configure for release builds, add the following to your ~/.gradle/gradle.properties or android/gradle.properties:"
echo ""
echo "CUE_RELEASE_STORE_FILE=$KEYSTORE_PATH"
echo "CUE_RELEASE_KEY_ALIAS=$ALIAS"
echo "CUE_RELEASE_STORE_PASSWORD=<your-keystore-password>"
echo "CUE_RELEASE_KEY_PASSWORD=<your-key-password>"
echo ""
echo "Then build release APK with: cd android && ./gradlew assembleRelease"
