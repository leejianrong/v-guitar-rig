# v-guitar-rig

Browser guitar rig: pedals/amps modelled from real circuits, live signal visualisation, LLM vibe-coding via MCP/CLI. Start at `docs/PLAN.md`; build order and acceptance tests are in `docs/SLICES.md`; decisions in `docs/adr/`. Work is tracked on Pandan board `VGR` (one epic per slice) with the `pandan` CLI.

Trust the code over the docs where they disagree, and fix the docs in the same PR.

## Commands

- `make` lists targets. `make install` then `make hooks` once per clone.
- `make check` is the fast gate and what pre-push runs. Run it before proposing a push. Never add a slow or infra-needing check to it.
- `make test-integration` and `make test-e2e` build the WASM core first (`make wasm`). e2e also needs `pnpm --filter @rig/web exec playwright install chromium` once.
- Dev server: `pnpm --filter @rig/web dev` (needs `make wasm` first), http://127.0.0.1:5173.

## Constraints that aren't visible in one file

- `crates/rig-core` must stay free of browser/OS calls (ADR-0001): the same code runs in an AudioWorklet and in Node.
- AudioWorklet scope has no `TextEncoder`, `performance` or DOM. Anything imported by `apps/web/src/worklet.ts` (including `packages/dsp-host`) must avoid them.
- Generated module code is untrusted (ADR-0004). No secrets in git; `.env*` is ignored.
- Biome does not read `.gitignore`: new generated output folders must be added to `biome.json` excludes.
- pnpm 11 blocks dependency build scripts; allow them in `pnpm-workspace.yaml` `allowBuilds`.

## Workflow

- One branch per slice off `main`; PR only, after CI is green. Stacked PRs target the parent branch.
- Failing test first for every bug. Assert audible behaviour, not internals.
- Real-hardware latency and dropout checks are manual: `docs/hardware-checks.md`.
