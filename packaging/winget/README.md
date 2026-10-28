# winget

Three manifests (schema 1.10, multi-file format) for the package **`BackstageCoding.Sara`**:

- In `manifest/`: `BackstageCoding.Sara.yaml` (version), `….installer.yaml` (installer), `….locale.en-US.yaml`
  (default locale).
- The installer is the GitHub Release asset `Sara-Setup-<version>.exe` (Inno Setup). winget runs it
  silently **for the signed-in user**: `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /CURRENTUSER /MODE=user`
  (no administrator; her server runs while you're signed in). The Windows-service mode needs an
  administrator and a question, so it stays in the normal installer.
- `ProductCode` is the installer's AppId (`{6F0B2C1E-…}_is1`) so winget recognises an existing
  install and upgrades it.

Users install with `winget install BackstageCoding.Sara` (after 1.0).

## At each release (owner)

1. `node scripts/update-packaging.ts <version>` fills `PackageVersion`, `InstallerUrl`,
   `InstallerSha256` and `ReleaseDate` from `outputs/release/<version>/SHA256SUMS`, and writes a
   submission copy to `outputs/release/<version>/winget/manifests/b/BackstageCoding/Sara/<version>/`.
2. Validate and try it (Windows):

   ```sh
   winget validate --manifest outputs/release/<v>/winget/manifests/b/BackstageCoding/Sara/<v>
   winget settings --enable LocalManifestFiles     # once, as administrator
   winget install --manifest outputs/release/<v>/winget/manifests/b/BackstageCoding/Sara/<v>
   ```

3. Submit: fork [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs), add that folder
   under `manifests/b/BackstageCoding/Sara/<v>/`, open a PR (or use
   `wingetcreate submit <folder>`). Their bots validate and install-test it in a sandbox.

The installer is not code-signed yet; winget-pkgs accepts unsigned installers, but SmartScreen
and some antivirus checks in their pipeline can flag them. Signing the installer before 1.0 makes
this smoother.

`winget validate --manifest packaging/winget/manifest` passes on the files here (checked on the dev PC with winget 1.29).
