# Production dependency record

The current Linux application uses the pinned versions in `pnpm-lock.yaml`. There is no Cargo workspace or Rust runtime dependency. Electron supplies the desktop runtime; a pinned Node executable and native addons are bundled with Linux candidates. Exact shipped files are checked by the [Node package inspector](node-linux-packaging.md).

| Package                                                              | Purpose                                                             | Location                                                        |
| -------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------- |
| Electron, `electron-updater`                                         | Native windows, browser views, OS integration, and explicit updates | `apps/desktop`                                                  |
| React, React DOM, Zustand, Radix UI, dnd-kit, react-resizable-panels | Workspace presentation and interaction                              | `apps/web`                                                      |
| xterm.js and addons                                                  | Terminal display, fitting, search, and checkpoints                  | `apps/web`                                                      |
| Hono, `@hono/node-server`                                            | Authenticated local HTTP boundary                                   | `apps/server`                                                   |
| `better-sqlite3`                                                     | Durable local state and revisioned mutations                        | `apps/server`                                                   |
| `node-pty`                                                           | Local terminal processes and resize                                 | `apps/server`                                                   |
| `koffi` 3.3.2 (MIT)                                                  | Windows owner-only DACLs and process-managed file locks             | `packages/client-runtime`, `apps/desktop`                       |
| `ssh2`                                                               | Remote SSH/tmux transport                                           | `apps/server`                                                   |
| `dbus-next`                                                          | Linux Secret Service integration                                    | `apps/server`                                                   |
| `@noble/ciphers`, `@noble/hashes`                                    | Encrypted content and key handling                                  | `apps/server`                                                   |
| `ws`                                                                 | Bounded local event transport                                       | `apps/server`                                                   |
| Zod                                                                  | Validation at contract, IPC, and service boundaries                 | `packages/contracts`, `packages/protocol-client`, `apps/server` |

The shadcn Select, Checkbox, and RadioGroup controls use `@radix-ui/react-select` 2.3.3,
`@radix-ui/react-checkbox` 1.3.7, and `@radix-ui/react-radio-group` 1.4.3 (MIT). These
renderer-only dependencies contain no native addons. Their versions match the existing
Radix Dialog focus and dismissal primitives so selectors work inside settings dialogs.

Shared progress indicators use `@radix-ui/react-progress` 1.1.8 (MIT); the command
palette uses `cmdk` 1.1.1 (MIT) for keyboard selection and option semantics. Both
are renderer-only dependencies without native addons. `cmdk` resolves to the
existing Radix Dialog version rather than a second focus/dismissal stack.

The manifests are authoritative for exact direct dependencies. Build and test tools, including TypeScript, esbuild, Vite, Vitest, Playwright, ESLint, Prettier, and Electron Builder, are declared separately. New production dependencies require a documented purpose, license review, locked version, native-package compatibility check where applicable, and updated SBOM and vulnerability evidence before release.

`http-cache-semantics` 4.3.0 (BSD-2-Clause) carries a local backport of the reuse and
revalidation repair in [upstream PR #63](https://github.com/kornelski/http-cache-semantics/pull/63),
at commit `609bbde04df50f40d31ec5f84800774bc3f963fb`. The checked-in pnpm patch
prevents stale directives from bypassing required validation and prevents error fallback
for a different request. Three focused release tests exercise the installed patched package.
As of 2026-10-09, this PR is unmerged; the patch is not a released upstream security fix.
The maintainer disputes [GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp)
in [issue #56](https://github.com/kornelski/http-cache-semantics/issues/56).
Updating to 4.3.0 alone leaves the stale-reuse behavior unchanged; the local patch supplies
the repair. No advisory exemptions are configured.
