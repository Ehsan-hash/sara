# CasaOS / ZimaOS

`docker-compose.yml` is a CasaOS app: plain Docker Compose (image `ghcr.io/farena-ai/sara:<version>`,
port 7860, data in `/DATA/AppData/sara/data` at `/data`) plus the top-level `x-casaos` block the
store reads (id `com.backstagecoding.sara`, category `AI`, amd64 + arm64, icon, thumbnail and three
screenshots). Format:
[compose-and-x-casaos](https://github.com/IceWhaleTech/CasaOS-AppStore/blob/main/docs/specs/compose-and-x-casaos.md)
and [assets-and-i18n](https://github.com/IceWhaleTech/CasaOS-AppStore/blob/main/docs/specs/assets-and-i18n.md).

## First sign-in (Phase 59)

CasaOS puts no login in front of an app, so anyone on the network reaches Sara's page first. A new
Sara therefore asks for the 8-character **setup code** from her log (the app's menu ⋮ → *Logs*,
next to "setup code") within an hour of the start, then shows the owner token once.
`tips.before_install` says so. Restarting the app gives a new code.

## The submission folder

`outputs/casaos/Apps/Sara/` is the whole `Apps/Sara/` folder for the store: this
`docker-compose.yml`, `icon.png` (256×256, from `web/icon-512.png`), `thumbnail.png` and
`screenshot-1.png` to `screenshot-3.png` (1440×900, from a throwaway server, example owner "Alex").
The icon and screenshot URLs in the compose point at
`https://cdn.jsdelivr.net/gh/IceWhaleTech/CasaOS-AppStore@main/Apps/Sara/…`, where the store serves
them after the merge (like every other app there), so a *Custom Install* before the merge shows no
icon; that's expected.

## Checked here

- The store's own validator (`.github/actions/validate-compose/scripts/validate_compose.py`, from a
  checkout of IceWhaleTech/CasaOS-AppStore with the folder as `Apps/Sara`):
  `python3 validate_compose.py --app-path Sara --report-json report.json --skip-compose-config` →
  status `success`, 0 errors, 0 warnings.
- `docker compose config -q` part: `podman-compose -f docker-compose.yml config` on the Linux
  server resolves it (Docker isn't on the dev PC).

## Submit (owner)

Best with the 1.1 image (browser setup, arm64); 1.0.0 is amd64 only, which `architectures` would
overstate.

1. `node scripts/update-packaging.ts <version>` sets the image tag, `version` and `update_at`; copy
   the compose to `outputs/casaos/Apps/Sara/` again.
2. Try it on your own CasaOS/ZimaOS: *App Store → Custom Install → Import*, paste the file, install,
   open, set up with the code from the logs. The store asks for apps to be tested first.
3. Fork [IceWhaleTech/CasaOS-AppStore](https://github.com/IceWhaleTech/CasaOS-AppStore), copy
   `outputs/casaos/Apps/Sara/` to `Apps/Sara/`, open a PR against `main` saying it is a new app and
   how you tested it.

Their GitHub Actions (`validator.yml`: the validator above, `docker compose config -q`, and a store
build) run on the PR in their repository; a first-time contributor's PR may wait for a maintainer
to approve those runs. Nothing runs in our repositories.
