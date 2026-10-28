# Unraid Community Applications

`sara.xml` is a Docker template for [Community Applications](https://docs.unraid.net/community-applications/)
(CA): image `ghcr.io/farena-ai/sara:latest`, web UI on port 7860, data in
`/mnt/user/appdata/sara` (mounted at `/data`). It keeps the same hardening as Sara's
`docker-compose.yml` (all capabilities dropped except the six her command sandbox needs,
`no-new-privileges`) through `ExtraParams`. Icon: `web/icon-512.png` from the public repository;
support: GitHub issues; project: the website; three screenshots.

First sign-in (Phase 59): Unraid puts no login in front of a container's WebUI, so a new Sara asks
for the 8-character setup code from the container's log (Docker tab → Sara's icon → *Logs*) within
an hour of the start; the `Overview` says so.

Try it on an Unraid server before submitting: copy `sara.xml` to
`/boot/config/plugins/dockerMan/templates-user/my-Sara.xml`, then *Docker → Add Container →
Template: Sara*.

## The templates repository

CA reads templates from a public GitHub repository with `ca_profile.xml` at its root and one XML
per app under `templates/` (layout of the
[starter](https://github.com/unraid/unraid-community-apps-starter)). `outputs/unraid-templates/`
is that repository for **farena-ai/unraid-templates**, ready to push: `ca_profile.xml`, `icon.png`,
`templates/sara.xml` (a copy of this file), `screenshots/sara-1.png` to `sara-3.png`, `README.md`,
`LICENSE` (MIT). `TemplateURL` and the screenshot URLs point at that repository's raw files.
Copy `sara.xml` there again whenever it changes here.

Checked here: both XML files parse; `test/packaging.test.ts` checks the template's image, port,
paths and capabilities. CA's own *Validate*/*Scan* only run on its website (step 3).

## Submit (owner)

1. The image is public already (`ghcr.io/farena-ai/sara`, 1.0.0 amd64; `latest` becomes multi-arch
   with the next `release-docker.sh --push`).
2. Create the public repository `farena-ai/unraid-templates` and push `outputs/unraid-templates/`
   to `main`.
3. Sign in at https://ca.unraid.net/submit/new with GitHub, enter the repository URL, run
   *Validate* and *Scan*, then send it for review. A forum support thread (Unraid forums, *Docker
   Containers*) is often asked for; GitHub issues is set as `Support` now.

Field reference: https://ca.unraid.net/submit/help/xml-field-reference. No GitHub Actions involved.
