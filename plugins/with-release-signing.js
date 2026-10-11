// Signs release builds with Cue's own key instead of the debug key Expo's template uses. The key's location and
// passwords come from Gradle properties (CUE_RELEASE_STORE_FILE, _STORE_PASSWORD, _KEY_ALIAS, _KEY_PASSWORD, kept in
// ~/.gradle/gradle.properties, never in the repo). Without them the release build falls back to the debug key.
const { withAppBuildGradle } = require('expo/config-plugins')

const MARKER = '// cue: release signing'

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    let gradle = mod.modResults.contents
    if (gradle.includes(MARKER)) return mod
    gradle = gradle.replace(
      /signingConfigs \{\n(\s+)debug \{/,
      (match, indent) =>
        `signingConfigs {\n${indent}${MARKER}\n${indent}release {\n` +
        `${indent}    if (project.hasProperty('CUE_RELEASE_STORE_FILE')) {\n` +
        `${indent}        storeFile file(CUE_RELEASE_STORE_FILE)\n` +
        `${indent}        storePassword CUE_RELEASE_STORE_PASSWORD\n` +
        `${indent}        keyAlias CUE_RELEASE_KEY_ALIAS\n` +
        `${indent}        keyPassword CUE_RELEASE_KEY_PASSWORD\n` +
        `${indent}    }\n${indent}}\n${indent}debug {`,
    )
    gradle = gradle.replace(
      /(release \{\n\s+\/\/ Caution! In production[^\n]*\n[^\n]*\n\s+)signingConfig signingConfigs\.debug/,
      "$1signingConfig project.hasProperty('CUE_RELEASE_STORE_FILE') ? signingConfigs.release : signingConfigs.debug",
    )
    mod.modResults.contents = gradle
    return mod
  })
}
