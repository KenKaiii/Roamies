# AGENTS.md

Roamies: a Tauri 2 desktop app (Rust shell in `showcase/tauri/src-tauri`), a Node sidecar that runs the
agent (`showcase/tauri/sidecar`), shared browser JS in `showcase/roamies`, and macOS Swift helpers built by
`src-tauri/build.rs`.

## Commands

```sh
cd showcase/tauri/sidecar && npm ci     # install sidecar deps
npm test                                # sidecar tests (reply stream, storage)
npm run build                           # bundle the sidecar into dist/
cd .. && ./build.sh dev                 # web files + sidecar + debug `cargo build`
./build.sh                              # release bundle for this OS (signs on macOS if a Developer ID is in the keychain)
```

There is no linter configured yet.

Releases: push a `v*` tag (or run `.github/workflows/release.yml` by hand). It builds a signed, notarized
macOS DMG (Apple silicon and Intel) and an unsigned Windows installer into a draft GitHub release.

## Rules

- CI lives in `.github/workflows/ci.yml` and must stay green.
- Never commit with `--no-verify`.
- Never commit secrets (Apple ID passwords, certificates, `~/.gg/auth.json`); signing credentials go in GitHub Actions secrets.
