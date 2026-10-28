# CasaOS / ZimaOS

`docker-compose.yml` is a CasaOS app: plain Docker Compose (image `ghcr.io/farena-ai/sara:<version>`,
port 7860, data in `/DATA/AppData/sara/data` at `/data`) plus the top-level `x-casaos` block the
store reads (id `com.backstagecoding.sara`, category `AI`, amd64 + arm64). Format:
[compose-and-x-casaos](https://github.com/IceWhaleTech/CasaOS-AppStore/blob/main/docs/specs/compose-and-x-casaos.md).

Try it first on your own CasaOS: *App Store → Custom Install → Import* and paste the file (the
store requires PRs to be tested on CasaOS first).

## Submitting (owner, after the 1.0 release and the public image)

1. `node scripts/update-packaging.ts <version>` sets the image tag, `version` and `update_at`.
2. Fork [IceWhaleTech/CasaOS-AppStore](https://github.com/IceWhaleTech/CasaOS-AppStore), add
   `Apps/Sara/docker-compose.yml` (this file) and an `icon.png` (copy `web/icon-512.png`), plus
   screenshots if wanted (`screenshot-1.png` …, listed under `screenshot_link`).
3. Check: `docker compose -f Apps/Sara/docker-compose.yml config -q`.
4. Open the PR, following the store's CONTRIBUTING.md and PR template at that time.

The owner token is printed in the container log on first start (CasaOS shows logs in the app's
settings); the `tips.before_install` text tells users so.
