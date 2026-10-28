# Umbrel

`umbrel-app.yml` + `docker-compose.yml` follow the
[Umbrel app framework](https://github.com/getumbrel/umbrel-apps): the `app_proxy` service publishes
the web UI on port 7860 and forwards to `sara_server_1:7860`; her data is in
`${APP_DATA_DIR}/data` (mounted at `/data`).

Sign-in rate limits: the compose runs Sara in proxy-secret mode (`SARA_TRUST_PROXY=1` with
`SARA_PROXY_SECRET=${APP_SEED}`). Umbrel's app proxy can't send the matching `X-Sara-Proxy`
header, so Sara never believes an `X-Forwarded-For` address there: nothing else on the Umbrel
network can pretend to be another address to get around the sign-in limit.

## Before submitting

- **Owner token:** the Umbrel App Store asks that an app can be set up from the browser without
  reading logs. Sara prints her one-time owner token in the container log (Umbrel shows it under
  *Troubleshoot*). That works but may not pass review; a browser-only first sign-in for app-store
  installs would need a change in Sara (open item, not done in Phase 57).
- **Port:** 7860 must not clash with another app in the store; pick another if the reviewers ask.
- **Gallery:** add `1.jpg`–`3.jpg` (1440×900 screenshots) in the app folder.
- **Digest:** Umbrel wants images pinned by digest. After `release-docker.sh --push`:
  `docker buildx imagetools inspect ghcr.io/farena-ai/sara:<version>` shows it; then
  `node scripts/update-packaging.ts <version> --image-digest sha256:<digest>`.

## Test and submit (owner, after 1.0)

1. Test on an Umbrel (or umbrelOS in a VM): copy the folder to `~/umbrel/app-stores/…` through a
   [community app store](https://github.com/getumbrel/umbrel-community-app-store) of your own, or
   follow the testing guide in the umbrel-apps repository (`AGENTS.md` there lists the current
   packaging and testing skills).
2. Fork getumbrel/umbrel-apps, add the folder as `sara/`, open the PR, then put its URL in
   `submission:` in umbrel-app.yml.
