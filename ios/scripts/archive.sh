#!/usr/bin/env bash
# Builds Sara for the App Store and uploads it to App Store Connect (Phase 25, on the Mac).
# Needs: Xcode signed in to the Apple developer account (Xcode → Settings → Accounts), and your
# Apple Team ID (developer.apple.com → Membership details):
#   SARA_TEAM_ID=ABCDE12345 ios/scripts/archive.sh [build number]
set -euo pipefail
cd "$(dirname "$0")/.."
BUILD="${1:-$(date +%Y%m%d%H%M)}"
: "${SARA_TEAM_ID:?Set SARA_TEAM_ID to your Apple Team ID (developer.apple.com → Membership details).}"
rm -rf build/Sara.xcarchive build/export
xcodebuild -project Sara.xcodeproj -scheme Sara -configuration Release \
  -destination 'generic/platform=iOS' -archivePath build/Sara.xcarchive \
  -allowProvisioningUpdates SARA_TEAM_ID="$SARA_TEAM_ID" CURRENT_PROJECT_VERSION="$BUILD" archive
xcodebuild -exportArchive -archivePath build/Sara.xcarchive -exportPath build/export \
  -exportOptionsPlist scripts/ExportOptions.plist -allowProvisioningUpdates
echo "Uploaded build $BUILD. It shows in App Store Connect → TestFlight after processing (5–30 min)."
