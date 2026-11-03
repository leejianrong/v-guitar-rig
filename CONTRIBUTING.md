# Contributing

## Setup

```bash
make install   # frozen JS install and Rust toolchain from rust-toolchain.toml
make hooks     # pre-push runs `make check`
make           # list all targets
```

## Checks

| Command | What it runs | Needs |
|---------|--------------|-------|
| `make check` | Biome, rustfmt, clippy, type-check, unit tests (the fast gate) | nothing else |
| `make test-integration` | The WASM core in Node: error paths, stability, CPU headroom | `make wasm` (done for you) |
| `make test-e2e` | Headless Chromium: live clipper, and browser-vs-Node render parity | `pnpm --filter @rig/web exec playwright install chromium` once |
| `make test-compose` | Boots the real docker compose stack: auth, loopback-only binding, UI connects | Docker, Playwright Chromium |

CI runs the same jobs. Real-interface latency and stability can't run in CI; record them in [docs/hardware-checks.md](docs/hardware-checks.md).

## Workflow

- One branch per slice off `main`; changes land by pull request after CI is green.
- Write a failing test before fixing a bug. Test audible behaviour (spectra, levels, no NaN), not internals.
- Update the README, `AGENTS.md` and docs in the same pull request as the change they describe.
- Slices and acceptance tests live in [docs/SLICES.md](docs/SLICES.md); decisions in [docs/adr/](docs/adr/).
