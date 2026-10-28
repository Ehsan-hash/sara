#!/usr/bin/env bash
# Builds Sara's container image with Docker (buildx) or Podman. Phase 57, multi-arch in Phase 59;
# the owner runs it by hand (no CI).
#
#   bash scripts/release-docker.sh                 # build for this machine's platform and load it
#                                                  # into the local image store as sara:<version>
#   bash scripts/release-docker.sh --platform linux/arm64   # same, another platform (needs QEMU)
#   bash scripts/release-docker.sh --all           # build linux/amd64 AND linux/arm64 (local only,
#                                                  # nothing pushed)
#   bash scripts/release-docker.sh --push          # build linux/amd64 + linux/arm64 and PUSH one
#                                                  # multi-arch manifest: ghcr.io/farena-ai/sara:<version>
#                                                  # and :latest
#   bash scripts/release-docker.sh --dry-run ...   # print the commands, run nothing
#   --engine docker|podman                         # default: docker when it has buildx, else podman
#
# Nothing is pushed without --push. Before --push, sign in to the GitHub container registry once
# (the token needs the write:packages scope; add it with: gh auth refresh -s write:packages):
#
#   gh auth token | docker login ghcr.io -u <your-github-user> --password-stdin
#   gh auth token | podman login ghcr.io -u <your-github-user> --password-stdin   # with Podman
#
# Building the other architecture needs QEMU: Docker Desktop has it; on Linux register it (until
# the next reboot) with: docker run --privileged --rm tonistiigi/binfmt --install arm64 (or podman).
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
PUSH=0 DRY=0 ALL=0 PLATFORM="" LATEST=1 ENGINE=""

usage() { sed -n '2,27p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --push) PUSH=1; shift ;;
    --all) ALL=1; shift ;;
    --dry-run) DRY=1; shift ;;
    --platform) PLATFORM="${2:?--platform needs a value}"; shift 2 ;;
    --platform=*) PLATFORM="${1#*=}"; shift ;;
    --engine) ENGINE="${2:?--engine needs docker or podman}"; shift 2 ;;
    --engine=*) ENGINE="${1#*=}"; shift ;;
    --no-latest) LATEST=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done

VERSION="$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' "$ROOT/package.json" | head -1)"
[[ -n "$VERSION" ]] || { echo "No version in package.json" >&2; exit 1; }
# The Dockerfile pins the same Node.js as the native installer (with that tag's multi-arch digest).
NODE_VERSION="$(sed -n 's/^NODE_VERSION=v\{0,1\}\([0-9.]*\).*/\1/p' "$ROOT/deploy/install.sh" | head -1)"
DF_NODE="$(sed -n 's/^ARG NODE_VERSION=\([0-9.]*\).*/\1/p' "$ROOT/Dockerfile" | head -1)"
[[ -n "$NODE_VERSION" && "$NODE_VERSION" == "$DF_NODE" ]] || { echo "The Dockerfile's Node.js ($DF_NODE) differs from deploy/install.sh ($NODE_VERSION): update NODE_VERSION and NODE_DIGEST in the Dockerfile." >&2; exit 1; }

if [[ -z "$ENGINE" ]]; then
  if command -v docker >/dev/null && docker buildx version >/dev/null 2>&1; then ENGINE=docker
  elif command -v podman >/dev/null; then ENGINE=podman
  else ENGINE=docker; fi
fi
[[ $ENGINE == docker || $ENGINE == podman ]] || { echo "--engine is docker or podman" >&2; exit 2; }

run() {
  printf '+'; printf ' %q' "$@"; printf '\n'
  [[ $DRY == 1 ]] || "$@"
}

ARGS=(--file "$ROOT/Dockerfile" --build-arg "SARA_VERSION=$VERSION"
  --label "org.opencontainers.image.version=$VERSION"
  --label "org.opencontainers.image.created=$(date -u +%Y-%m-%dT%H:%M:%SZ)")
REV="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || true)"
[[ -n "$REV" ]] && ARGS+=(--label "org.opencontainers.image.revision=$REV")

if [[ $DRY == 0 ]]; then
  if [[ $ENGINE == docker ]]; then
    command -v docker >/dev/null || { echo "Neither Docker (with buildx) nor Podman is installed." >&2; exit 1; }
    docker buildx version >/dev/null 2>&1 || { echo "docker buildx isn't available; install the buildx plugin (or use --engine podman)." >&2; exit 1; }
  else
    command -v podman >/dev/null || { echo "Podman isn't installed." >&2; exit 1; }
  fi
fi

NATIVE="linux/$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')"
# A build for another architecture runs its RUN steps under QEMU: say so before a long failure.
need_qemu() {
  local p q
  for p in ${1//,/ }; do
    [[ $p == "$NATIVE" || $DRY == 1 || $(uname -s) != Linux ]] && continue
    q="qemu-${p#linux/}"; q="${q/arm64/aarch64}"; q="${q/amd64/x86_64}"
    [[ -e /proc/sys/fs/binfmt_misc/$q ]] || echo "Note: no QEMU handler for $p here; register one with: $ENGINE run --privileged --rm docker.io/tonistiigi/binfmt --install ${p#linux/}" >&2
  done
}

# Podman builds a multi-arch manifest list under a name; an older list (or a one-platform image
# from a local build) under that name would be added to or refused, so it goes first (only that tag).
podman_fresh() {
  [[ $DRY == 1 ]] && return 0
  if podman manifest exists "$1" 2>/dev/null; then podman manifest rm "$1" >/dev/null
  elif podman image exists "$1" 2>/dev/null; then podman untag "$1" "$1" >/dev/null; fi
}

# Podman 4.x can't find a digest-pinned base image for the second platform of a multi-platform
# build unless each platform's copy was pulled first ("locating pulled image … image not known").
podman_base() {
  local digest p
  digest="$(sed -n 's/^ARG NODE_DIGEST=\(sha256:[0-9a-f]\{64\}\)$/\1/p' "$ROOT/Dockerfile" | head -1)"
  [[ -n "$digest" ]] || return 0
  for p in ${1//,/ }; do run podman pull -q --platform "$p" "docker.io/library/node@$digest"; done
}

if [[ $PUSH == 1 ]]; then
  [[ -z "$PLATFORM" ]] || { echo "--push always builds $PLATFORMS_ALL; leave out --platform." >&2; exit 2; }
  need_qemu "$PLATFORMS_ALL"
  TAGS=("$IMAGE:$VERSION")
  [[ $LATEST == 1 ]] && TAGS+=("$IMAGE:latest")
  if [[ $ENGINE == docker ]]; then
    # A builder that can build for other platforms (the default "docker" driver can't push
    # multi-platform images); created once, reused after.
    if [[ $DRY == 0 ]] && ! docker buildx inspect sara-builder >/dev/null 2>&1; then
      run docker buildx create --name sara-builder --driver docker-container
    fi
    TAGARGS=(); for t in "${TAGS[@]}"; do TAGARGS+=(--tag "$t"); done
    run docker buildx build --builder sara-builder --platform "$PLATFORMS_ALL" "${ARGS[@]}" "${TAGARGS[@]}" --push "$ROOT"
    INSPECT="docker buildx imagetools inspect $IMAGE:$VERSION"
  else
    # Podman: both platforms into one local manifest list, then push it (every image) per tag.
    # --format docker keeps the HEALTHCHECK (Podman drops it from OCI-format images).
    podman_fresh "$IMAGE:$VERSION"
    podman_base "$PLATFORMS_ALL"
    run podman build --format docker --platform "$PLATFORMS_ALL" "${ARGS[@]}" --manifest "$IMAGE:$VERSION" "$ROOT"
    for t in "${TAGS[@]}"; do run podman manifest push --all --format v2s2 "$IMAGE:$VERSION" "docker://$t"; done
    INSPECT="podman manifest inspect docker://$IMAGE:$VERSION"
  fi
  if [[ $DRY == 1 ]]; then echo "(dry run: nothing was built or pushed)"; else
    echo "Pushed $IMAGE:$VERSION$([[ $LATEST == 1 ]] && echo " and $IMAGE:latest") for $PLATFORMS_ALL."
    echo "Its multi-arch digest (for Umbrel and update-packaging.ts --image-digest): $INSPECT"
  fi
else
  if [[ $ALL == 1 ]]; then
    [[ -z "$PLATFORM" ]] || { echo "--all builds $PLATFORMS_ALL; leave out --platform." >&2; exit 2; }
    need_qemu "$PLATFORMS_ALL"
    # Both architectures, nothing pushed: Podman keeps them as the local manifest list
    # sara:<version>; buildx keeps them in its build cache (Docker can't load a multi-platform image).
    if [[ $ENGINE == docker ]]; then
      if [[ $DRY == 0 ]] && ! docker buildx inspect sara-builder >/dev/null 2>&1; then
        run docker buildx create --name sara-builder --driver docker-container
      fi
      run docker buildx build --builder sara-builder --platform "$PLATFORMS_ALL" "${ARGS[@]}" --tag "$IMAGE:$VERSION" "$ROOT"
    else
      podman_fresh "sara:$VERSION"
      podman_base "$PLATFORMS_ALL"
      run podman build --format docker --platform "$PLATFORMS_ALL" "${ARGS[@]}" --manifest "sara:$VERSION" "$ROOT"
    fi
    [[ $DRY == 1 ]] && { echo "(dry run: nothing was built)"; exit 0; }
    echo "Built sara:$VERSION for $PLATFORMS_ALL (local only; nothing pushed). Try one with --platform."
    exit 0
  fi
  # Local build: one platform, loaded into the local image store, tagged like the published image
  # and as sara:<version>. Pushes nothing.
  P="${PLATFORM:-$NATIVE}"
  need_qemu "$P"
  if [[ $ENGINE == docker ]]; then
    run docker buildx build --platform "$P" "${ARGS[@]}" --tag "sara:$VERSION" --tag "$IMAGE:$VERSION" --load "$ROOT"
  else
    run podman build --format docker --platform "$P" "${ARGS[@]}" --tag "sara:$VERSION" --tag "$IMAGE:$VERSION" "$ROOT"
  fi
  [[ $DRY == 1 ]] && { echo "(dry run: nothing was built)"; exit 0; }
  echo "Built sara:$VERSION for $P (local only; nothing pushed). Try it:"
  echo "  $ENGINE run -d --name sara-test -p 127.0.0.1:7860:7860 -v sara-test-data:/data sara:$VERSION"
  echo "  $ENGINE logs sara-test   # the owner token and the browser setup code"
fi
