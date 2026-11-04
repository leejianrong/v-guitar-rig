# v-guitar-rig

Browser guitar rig: pedals/amps modelled from real circuits, live signal visualisation, LLM vibe-coding via MCP/CLI. Start at `docs/PLAN.md`; build order and acceptance tests are in `docs/SLICES.md`; decisions in `docs/adr/`. Work is tracked on Pandan board `VGR` (one epic per slice) with the `pandan` CLI.

Trust the code over the docs where they disagree, and fix the docs in the same PR.

## Commands

- `make` lists targets. `make install` then `make hooks` once per clone.
- `make check` is the fast gate and what pre-push runs. Run it before proposing a push. Never add a slow or infra-needing check to it.
- `make test-integration` and `make test-e2e` build the WASM core first (`make wasm`). e2e also needs `pnpm --filter @rig/web exec playwright install chromium` once.
- `make test-compose` boots the real docker stack (about a minute). `make up` runs it for manual use; rig files live in `./rig` (ignored).
- CLI during development: `pnpm --filter @rig/daemon build` then `node packages/daemon/dist/rig.mjs <cmd>`. Exit codes: 0 ok, 1 error, 2 validation, 3 stale rev, 4 module failure.
- `make demo` builds and serves everything locally on a free port (no Docker).
- Dev server: `pnpm --filter @rig/web dev` (needs `make wasm` first), http://127.0.0.1:5173.

## Constraints that aren't visible in one file

- `Chain` (`packages/dsp-host/src/chain.ts`) is the one board engine; the worklet and `renderBoard` both run it. Never fork the processing path (parity is tested). A new pedal is a `ModuleDef` in `starter.ts`/`modules.ts` (param specs, `create`), plus an enamel colour in `apps/web/src/ui/finish.ts`.
- Every UI change is driven in a real browser with Playwright (`apps/web/e2e`) before it is called done: drag, wheel, click, and a screenshot look.
- UI work follows the `frontend-design` skill; keep the visual language (enamel pedals, jacks, amber signal). `@fontsource` imports have no `.css` suffix (package exports map).

- `crates/rig-core` must stay free of browser/OS calls (ADR-0001): the same code runs in an AudioWorklet and in Node.
- AudioWorklet scope has no `TextEncoder`, `performance` or DOM. Anything imported by `apps/web/src/worklet.ts` (including `packages/dsp-host`) must avoid them.
- The daemon is the only writer of board files (ADR-0002); boards carry `rev` and stale writes get 409/exit 3. Keep `127.0.0.1` binding and the Host check: compose publishes loopback only.
- Generated module code is untrusted (ADR-0004): `compileModule`/`gateModule` execute it, so only call them with a `Realm` inside the sandbox process (`packages/daemon/src/sandbox*.ts`), never in the daemon. The daemon build makes two bundles (`rig.mjs`, `sandbox.mjs`); keep both in the image. No secrets in git; `.env*` is ignored.
- Biome does not read `.gitignore`: new generated output folders must be added to `biome.json` excludes.
- pnpm 11 blocks dependency build scripts; allow them in `pnpm-workspace.yaml` `allowBuilds`.

## Workflow

- One branch per slice off `main`; PR only, after CI is green. Stacked PRs target the parent branch.
- Failing test first for every bug. Assert audible behaviour, not internals.
- Real-hardware latency and dropout checks are manual: `docs/hardware-checks.md`.
