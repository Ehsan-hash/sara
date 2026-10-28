# TrueNAS SCALE

Since TrueNAS SCALE 24.10 (Electric Eel; current releases 25.04 / 25.10) apps run on Docker, and
any image can be installed as a **custom app** from Docker Compose YAML. `docker-compose.yml` here
is that YAML: image `ghcr.io/farena-ai/sara:<version>`, web UI on port 7860, her data on a host
path (a dataset you create first). Available now: nothing has to be submitted anywhere.

## Install (users)

1. *Datasets*: create one for her data, for example `tank/apps/sara`.
2. *Apps → Discover Apps → ⋮ (next to Custom App) → Install via YAML*. Name: `sara`. Paste
   `docker-compose.yml` and change `/mnt/tank/apps/sara` to your dataset's path.
3. Open `http://<truenas address>:7860` within an hour and choose **Set up Sara**: it asks for the
   8-character setup code from the app's logs (*Apps → sara → Workloads → logs icon*, next to
   "setup code"), then shows your owner token once to save. Missed the hour? Restart the app for a
   new code. The owner token printed in the same log works too. (Setup in the browser comes with
   Sara 1.1; with 1.0.0, use the owner token from the log.)

Docs: [Installing Custom Apps](https://apps.truenas.com/managing-apps/installing-custom-apps/).

Checked here: `podman-compose config` resolves the file on the Linux server, and
`test/packaging.test.ts` checks image, port, data path and hardening. Not run on a TrueNAS box.

## The TrueNAS Apps catalog (owner, optional, later)

The catalog in [truenas/apps](https://github.com/truenas/apps) takes community apps in
`ix-dev/community/<name>/` with `app.yaml` (metadata, `train: community`), `ix_values.yaml`,
`questions.yaml` (the install form), `templates/docker-compose.yaml` (Jinja on their shared
`ix_lib`) and test values, built with their tooling (their CI runs in their repository). It is a
bigger port than the files here; open an issue or PR there following their contributing guide. Two
points they will ask about: the catalog prefers containers that run as the `apps` user (568), while
Sara's container starts as root (with capabilities dropped) so her shell commands run as a separate
user that can't read her keys; and the image must be public (it is).
