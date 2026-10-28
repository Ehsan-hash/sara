# Unraid Community Applications

`sara.xml` is a Docker template for [Community Applications](https://docs.unraid.net/community-applications/)
(CA): image `ghcr.io/farena-ai/sara:latest`, web UI on port 7860, data in
`/mnt/user/appdata/sara` (mounted at `/data`). It keeps the same hardening as Sara's
`docker-compose.yml` (all capabilities dropped except the six her command sandbox needs,
`no-new-privileges`) through `ExtraParams`.

Try it on an Unraid server before submitting: copy `sara.xml` to
`/boot/config/plugins/dockerMan/templates-user/my-Sara.xml`, then *Docker → Add Container →
Template: Sara*.

## Submitting (owner, after the 1.0 release)

CA reads templates from a public GitHub repository and moderates new ones.

1. Make the image public: push it with `bash scripts/release-docker.sh --push` and set the GHCR
   package to public.
2. Make a templates repository from the [starter](https://github.com/unraid/unraid-community-apps-starter)
   (for example `farena-ai/unraid-templates`), or keep using this file from the public sara
   repository; `TemplateURL` must point at the raw file you publish.
3. Add a support link CA moderators accept (a thread in the Unraid forum's *Docker Containers*
   section is usual; GitHub issues is in the template now).
4. Submit at https://ca.unraid.net/submit/new: *Validate*, then *Scan*, then send it for review.

Field reference: https://ca.unraid.net/submit/help/xml-field-reference
