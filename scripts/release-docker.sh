#!/usr/bin/env bash
# Builds Sara's container image with docker buildx. Phase 57: prepared for the 1.0 release; the
# owner runs it by hand (no CI).
#
#   bash scripts/release-docker.sh                 # build for this machine's platform and load it
#                                                  # into the local Docker as sara:<version>
#   bash scripts/release-docker.sh --platform linux/arm64   # same, another platform (needs QEMU)
#   bash scripts/release-docker.sh --dry-run       # print the docker commands, run nothing
#   bash scripts/release-docker.sh --push          # build linux/amd64 + linux/arm64 and PUSH
#                                                  # ghcr.io/farena-ai/sara:<version> and :latest
#
# Nothing is pushed without --push. Before --push, sign in to the GitHub container registry once
# (the token needs the write:packages scope; add it with: gh auth refresh -s write:packages):
#
#   gh auth token | docker login ghcr.io -u <your-github-user> --password-stdin
#
# After the first push, make the package public on GitHub (Packages → sara → Package settings →
# Change visibility) and link it to the farena-ai/sara repository, so anyone can pull it without
# signing in.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Native tools (docker, git) on Windows git-bash need a C:/-style path.
if command -v cygpath >/dev/null; then ROOT="$(cygpath -m "$ROOT")"; fi
IMAGE="${SARA_IMAGE:-ghcr.io/farena-ai/sara}"
PLATFORMS_ALL="linux/amd64,linux/arm64"
PUSH=0 DRY=0 PLATFORM="" LATEST=1

usage() { sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --push) PUSH=1; shift ;;
    --dry-run) DRY=1; shift ;;
    --platform) PLATFORM="${2:?--platform needs a value}"; shift 2 ;;
    --platform=*) PLATFORM="${1#*=}"; shift ;;
    --no-latest) LATEST=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done

VERSION="$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' "$ROOT/package.json" | head -1)"
[[ -n "$VERSION" ]] || { echo "No version in package.json" >&2; exit 1; }
# Same pinned Node.js as the native installer.
NODE_VERSION="$(sed -n 's/^NODE_VERSION=v\{0,1\}\([0-9.]*\).*/\1/p' "$ROOT/deploy/install.sh" | head -1)"
[[ -n "$NODE_VERSION" ]] || { echo "No NODE_VERSION in deploy/install.sh" >&2; exit 1; }

run() {
  printf '+'; printf ' %q' "$@"; printf '\n'
  [[ $DRY == 1 ]] || "$@"
}

ARGS=(--file "$ROOT/Dockerfile" --build-arg "NODE_VERSION=$NODE_VERSION" --build-arg "SARA_VERSION=$VERSION"
  --label "org.opencontainers.image.version=$VERSION"
  --label "org.opencontainers.image.created=$(date -u +%Y-%m-%dT%H:%M:%SZ)")
REV="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || true)"
[[ -n "$REV" ]] && ARGS+=(--label "org.opencontainers.image.revision=$REV")

if [[ $DRY == 0 ]]; then
  command -v docker >/dev/null || { echo "Docker isn't installed (needs Docker with the buildx plugin)." >&2; exit 1; }
  docker buildx version >/dev/null 2>&1 || { echo "docker buildx isn't available; install the buildx plugin." >&2; exit 1; }
fi

if [[ $PUSH == 1 ]]; then
  [[ -z "$PLATFORM" ]] || { echo "--push always builds $PLATFORMS_ALL; leave out --platform." >&2; exit 2; }
  TAGS=(--tag "$IMAGE:$VERSION")
  [[ $LATEST == 1 ]] && TAGS+=(--tag "$IMAGE:latest")
  # A builder that can build for other platforms (the default "docker" driver can't push
  # multi-platform images); created once, reused after.
  if [[ $DRY == 0 ]] && ! docker buildx inspect sara-builder >/dev/null 2>&1; then
    run docker buildx create --name sara-builder --driver docker-container
  fi
  run docker buildx build --builder sara-builder --platform "$PLATFORMS_ALL" "${ARGS[@]}" "${TAGS[@]}" --push "$ROOT"
  [[ $DRY == 1 ]] && echo "(dry run: nothing was built or pushed)" || echo "Pushed $IMAGE:$VERSION$([[ $LATEST == 1 ]] && echo " and $IMAGE:latest") for $PLATFORMS_ALL."
else
  # Local build: one platform, loaded into the local image store (multi-platform images can't
  # be loaded), tagged like the published image and as sara:<version>. Pushes nothing.
  P="${PLATFORM:-linux/$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')}"
  run docker buildx build --platform "$P" "${ARGS[@]}" --tag "sara:$VERSION" --tag "$IMAGE:$VERSION" --load "$ROOT"
  [[ $DRY == 1 ]] && { echo "(dry run: nothing was built)"; exit 0; }
  echo "Built sara:$VERSION for $P (local only; nothing pushed). Try it:"
  echo "  docker run -d --name sara-test -p 127.0.0.1:7860:7860 -v sara-test-data:/data sara:$VERSION"
  echo "  docker logs sara-test   # the owner token"
fi
