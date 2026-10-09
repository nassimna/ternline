# Direct Arch Linux installation

`ternline-bin` repackages the published Linux x86_64 DEB with its bundled Electron,
Node runtime, and native addons. It preserves the `agent-workspace` identity, desktop
entry, icon, and existing profile (`$XDG_CONFIG_HOME/Agent Workspace`, normally
`~/.config/Agent Workspace`). It adds `ternline` and `ternline-cli` commands.
OpenSSH is required at startup. A system Node installation and FUSE are unnecessary.

AUR publication is paused. These instructions work without an AUR account.
Ternline is alpha software; read [the installation limitations](../../docs/INSTALLATION.md).

## Install a release package

Open [GitHub Releases](https://github.com/nassimna/ternline/releases) and choose one
release. Releases produced by the updated workflow include:

- `ternline-bin-ARCH_VERSION-1-x86_64.pkg.tar.zst`
- `ternline-bin-VERSION-recipe.tar.gz` containing the exact `PKGBUILD`, `.SRCINFO`, and CLI launcher
- `SHA256SUMS`, detached `.sig` files, and `ternline.pub`

The existing `v0.2.1-alpha.9` release has the verified Arch package and recipe as
additional downloads. Their checksums are in `SHA256SUMS-arch`, signed separately
to preserve the original release's `SHA256SUMS`. Future releases use the combined
`SHA256SUMS`. Download signatures do not provide macOS or Windows publisher trust.

Download the package, its checksum manifest, their matching `.sig` files, and a trusted copy
of [the public key](../../apps/website/public/ternline.pub). Verify before installing:

```sh
minisign -Vm SHA256SUMS-arch -x SHA256SUMS-arch.sig -p ternline.pub
minisign -Vm ternline-bin-ARCH_VERSION-1-x86_64.pkg.tar.zst -x ternline-bin-ARCH_VERSION-1-x86_64.pkg.tar.zst.sig -p ternline.pub
sha256sum ternline-bin-ARCH_VERSION-1-x86_64.pkg.tar.zst
# Compare the complete hash with the matching filename in SHA256SUMS-arch.
sudo pacman -U ./ternline-bin-ARCH_VERSION-1-x86_64.pkg.tar.zst
ternline
```

These manifest commands apply to `v0.2.1-alpha.9`; use `SHA256SUMS` and
`SHA256SUMS.sig` for subsequent releases.

Use `pacman -S --needed` to install any missing dependencies reported by `pacman -U`,
then retry. Launch **Ternline** from the application menu. With it running, check
`ternline-cli identify` from another terminal. The package manager owns the launchers,
desktop entry, icons, and `/usr/lib/ternline` runtime; it does not own your profile.

## Build the recipe

For a release with a recipe archive, verify its signature and checksum before
extracting it. Review all three files, then build as your regular user:

```sh
minisign -Vm ternline-bin-VERSION-recipe.tar.gz -x ternline-bin-VERSION-recipe.tar.gz.sig -p ternline.pub
tar -xzf ternline-bin-VERSION-recipe.tar.gz
makepkg --verifysource
makepkg --syncdeps --install
```

For the existing `v0.2.1-alpha.9` release, use this checkout's
`packaging/aur/ternline-bin` directory and review its files. The recipe pins the
published DEB's SHA-256. Follow [download verification](../../docs/INSTALLATION.md)
to authenticate that DEB with its release signature before running `makepkg`.
Do not run `makepkg` as root.

## Update and remove

Updates are manual until AUR publication resumes. Quit Ternline, verify the new
package from its own release, then repeat `sudo pacman -U ./NEW_PACKAGE`.
Alternatively build the new release's verified recipe. Never reuse old checksums
or change the recipe to `SKIP`. The in-app AppImage updater does not install Arch packages.

Remove only the application with:

```sh
sudo pacman -R ternline-bin
```

Your existing profile and workspaces remain. Reinstalling reuses that profile.
Back up your profile before evaluating alpha updates. Do not delete
`~/.config/Agent Workspace` unless you intend to erase your user data.

## Maintainer checks

```sh
makepkg --verifysource
makepkg
namcap PKGBUILD ternline-bin-*.pkg.tar.zst
makepkg --printsrcinfo > .SRCINFO
```

The recipe uses `/usr/lib/ternline`, retains the upstream binaries without stripping,
and removes unused Python native-addon build files. Namcap still warns about upstream
RELRO/stripping, foreign prebuilds, bundled Node script interpreters, and dependency
heuristics. Adding Python or system Node would not fix runtime requirements. Keep the
bundled runtime and its manifest hashes; investigate new lint errors before release.

The release workflow runs `scripts/release/build-arch-package.sh` against the exact
DEB from the same build. It generates version/hash-pinned metadata, builds with
`makepkg`, blocks namcap errors, and attaches the package and tagged recipe before
combined checksums and signatures are created. The pinned CI container proves packaging
and lint only. Before publishing, qualify the exact package on a native Arch host:
menu launch, Chromium sandbox without `--no-sandbox`, CLI, workspace creation,
PTY output, embedded browser, restart, update/reinstall, and profile-preserving removal.

Do not alter the bundled Electron fuses, application identity, or profile path.
An AUR submission, when available, is a separate approved publication step.

## Native qualification: alpha.9 Arch package

Verified on 9 October 2026 using an existing Arch Linux x86_64 host,
kernel `6.18.37-1-lts`, and an isolated Xvfb X11 session:

| Check                                                        | Result                                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Desktop entry launch and required OpenSSH                    | PASS                                                                                        |
| Chromium sandbox                                             | PASS: root-owned sandbox mode 4755; renderer `NoNewPrivs=1`, `Seccomp=2`; no `--no-sandbox` |
| Default external CLI discovery and explicit session override | PASS                                                                                        |
| Workspace creation, real PTY output, embedded browser        | PASS                                                                                        |
| Restart and profile/workspace preservation                   | PASS                                                                                        |
| Pacman update, uninstall, reinstall                          | PASS: package revision 1 → 2 of the same alpha.9 binary; profile preserved                  |
| Package lint                                                 | PASS: zero namcap errors; 86 upstream/runtime heuristic warnings described above            |

Exact qualified downloads:

- `ternline-bin-0.2.1alpha9-1-x86_64.pkg.tar.zst`: SHA-256 `d78cc7ddebcaf05653b55dadc52e6d9529ca104d64bb1aec2a03c5cc4ef6b0ac`
- `ternline-bin-0.2.1-alpha.9-recipe.tar.gz`: SHA-256 `e26db54d45b5dd501e816087842a1403c54b726fb4e9f5261f3b7fbebd247267`

This qualifies the direct alpha package. Physical GPU/input, a native Wayland
desktop, and migration to a new application version remain NOT RUN.
