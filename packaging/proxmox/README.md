# Proxmox VE helper script

`sara.sh` runs on a Proxmox VE host and creates a **Debian 12 LXC container** with Sara installed by
her own installer (`deploy/get-sara.sh --yes --access lan`), then prints the address and where to
find the one-time owner token (it doesn't print the token itself). Settings are environment
variables (`var_cpu`, `var_ram`, `var_disk`, `var_storage`, `var_bridge`, `var_net`, `var_port`,
`var_access`, …; see the top of the script).

It installs the release it was made for: `var_ref` defaults to the tag `v<SARA_VERSION>`, and the
installer (`get-sara.sh`) is downloaded on the host and checked against its SHA256 before it runs
as root in the container. `scripts/update-packaging.ts` fills `SARA_VERSION` and `GET_SARA_SHA256`
at release (from the release's `SHA256SUMS`, which `scripts/release-assets.sh` makes with
`get-sara.sh` in it). For another branch or tag, give `var_sha256` from that release's
`SHA256SUMS`; without one the script warns that it didn't check. All settings are quoted
(`printf %q`) before they reach the container's shell.

```sh
# on the Proxmox host, as root (available after the 1.0 release, when the repository is public)
bash -c "$(curl -fsSL https://raw.githubusercontent.com/farena-ai/sara/main/packaging/proxmox/sara.sh)"
# with settings:
var_ram=4096 var_access=tailscale bash -c "$(curl -fsSL …/packaging/proxmox/sara.sh)"
```

It follows the look and the `var_*` settings of the
[community Proxmox VE helper scripts](https://github.com/community-scripts/ProxmoxVE), but is
self-contained (only `pct`, `pveam`, `pvesh`), so it works from Sara's own repository without
their framework.

## Listing it in the community scripts (owner, optional, after 1.0)

The community collection only accepts scripts written on its own framework: a `ct/sara.sh`
(container settings and `update_script`, sourcing `build.func`) plus an `install/sara-install.sh`
(runs inside the container), a JSON entry for the website, and a PR against
[community-scripts/ProxmoxVED](https://github.com/community-scripts/ProxmoxVED) (their testing
repository) first. Read their CONTRIBUTING guide at the time; the install part is simply:

```sh
curl -fsSL https://raw.githubusercontent.com/farena-ai/sara/main/deploy/get-sara.sh -o get-sara.sh
bash get-sara.sh --yes --access lan
```

and `update_script` is `sara update`. Note they now default new scripts to Debian 13; Sara's
installer supports both.

## Not tested here

This script was checked for syntax only (`bash -n`); it has not been run on a Proxmox host.
Test it on a scratch Proxmox VE 8/9 node before announcing it.
