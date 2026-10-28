# Umbrel

`umbrel-app.yml` + `docker-compose.yml` (+ the empty `data/.gitkeep`) follow the
[Umbrel app framework](https://github.com/getumbrel/umbrel-apps) and its packaging guide
(`.agents/skills/umbrel-package-app/SKILL.md` in that repository): the `app_proxy` service publishes
the web UI on port 7860 and forwards to `sara_server_1:7860`; her data is in `${APP_DATA_DIR}/data`
(mounted at `/data`). Port 7860 is free in the store (checked against every `umbrel-app.yml` and
compose file in getumbrel/umbrel-apps on 2026-10-27; Langflow uses 7860 only inside its container,
which doesn't count).

## First sign-in: in the browser, no logs (Phase 59)

The Umbrel App Store requires that an app can be set up from the browser, without SSH or reading
logs. The compose sets `SARA_SETUP=browser`: on a new install Sara shows **Set up Sara**, one click
makes the Umbrel user her owner, and she shows the owner token once to save (for phones and other
devices). That is safe only because Umbrel's login stays **on** for the web app and for
`/api/claim` (`PROXY_AUTH_BLACKLIST`), so nobody reaches the button without the Umbrel password.
The phone apps, other apps (`/v1`, `/mcp`) and Sara's sign-in API can't send Umbrel's cookie, so
`PROXY_AUTH_WHITELIST` lets `/api/*`, `/v1/*` and `/mcp` through to Sara's own sign-in. Details and
what is left: [THREAT_MODEL.md](../../docs/THREAT_MODEL.md), "First sign-in in the browser".

If the owner turns off "Require Umbrel login" for Sara (umbrelOS 2.0) **before** setting her up,
only the one-hour window and the home-network rule protect setup: set her up first.

Sign-in rate limits: proxy-secret mode (`SARA_TRUST_PROXY=1` with `SARA_PROXY_SECRET=${APP_SEED}`).
Umbrel's app proxy can't send the matching `X-Sara-Proxy` header, so Sara never believes an
`X-Forwarded-For` address there: nothing else on the Umbrel network can pretend to be another
address to get around the sign-in limit.

## Checked here

- Umbrel's own linter, from a checkout of getumbrel/umbrel-apps with this folder as `sara/`:
  `npm ci --ignore-scripts && node .tools/lint-apps.mjs sara --check-images` gives 0 errors except
  `image.architecture` (the 1.0.0 image is linux/amd64 only; it goes away with the multi-arch push)
  and 2 warnings to explain in the PR (`cap_add`, `security_opt`: see "Why the container starts as
  root" in [PACKAGING.md](../../docs/PACKAGING.md)). Without `--check-images`: 0 errors.
- `podman-compose config` with `APP_DATA_DIR`/`APP_SEED` set resolves the file.
- Not run on a real umbrelOS (none available); see step 2 below.

## Submit (owner)

Needs a Sara release with Phase 59 (browser setup) pushed as a multi-arch image; 1.0.0 has neither,
so this is for 1.1:

1. `bash scripts/release-docker.sh --push`, then
   `node scripts/update-packaging.ts <version> --image-digest sha256:<multi-arch index digest>`
   (the top-level digest from `docker buildx imagetools inspect ghcr.io/farena-ai/sara:<version>`
   or `podman manifest inspect docker://ghcr.io/farena-ai/sara:<version>`, not one platform's).
2. Test, as Umbrel asks (`umbrel-test-app` skill in their repository): umbrelOS in a VM or on a
   device, install through a [community app store](https://github.com/getumbrel/umbrel-community-app-store)
   of your own containing this folder, open it, click Set up Sara, restart the app, check the data
   stays.
3. Fork [getumbrel/umbrel-apps](https://github.com/getumbrel/umbrel-apps), copy this folder to
   `sara/` (`umbrel-app.yml`, `docker-compose.yml`, `data/.gitkeep`; `outputs/umbrel/sara/` is a
   ready copy), run their linter as above, open the PR against `master`, then set `submission:` in
   `umbrel-app.yml` to the PR's URL and push that to the PR.
4. PR description (their template): app and version, upstream `https://github.com/farena-ai/sara`,
   image `ghcr.io/farena-ai/sara` (built by `scripts/release-docker.sh`, multi-arch), what you
   tested, the root/capabilities explanation, and that setup is in the browser. Attach the gallery
   screenshots and the icon from `outputs/umbrel/pr-assets/` (`1.jpg` to `3.jpg`, 1440×900, from a
   throwaway server; `icon-512.png`). Umbrel makes and hosts the final gallery and icon, so
   `gallery: []` stays empty and no images go in the folder.

Their GitHub Action (`lint-apps.yml`) runs the same linter on the PR from their side
(`pull_request_target`: nothing to approve on our side).
