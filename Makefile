.DEFAULT_GOAL := help
.PHONY: help install demo check lint typecheck test test-unit test-integration test-e2e test-compose up wasm hooks

help: ## List targets
	@grep -E '^[a-zA-Z0-9_-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-18s %s\n", $$1, $$2}'

install: ## Install JS deps (frozen) and the pinned Rust toolchain
	pnpm install --frozen-lockfile
	rustup show active-toolchain >/dev/null

demo: wasm ## Build everything and serve the UI + daemon locally (no Docker, picks a free port)
	pnpm --filter @rig/web build
	pnpm --filter @rig/daemon build
	@port=7878; while ss -ltn | grep -q ":$$port "; do port=$$((port+1)); done; \
	echo "Open http://127.0.0.1:$$port  (Ctrl-C to stop)"; \
	node packages/daemon/dist/rig.mjs serve --rig-dir rig --web-dir apps/web/dist --port $$port

check: lint typecheck test-unit ## Fast gate: lint + types + no-infra tests (what pre-push runs)

lint: ## Biome, rustfmt, clippy
	pnpm lint
	cargo fmt --all -- --check
	cargo clippy --workspace --all-targets -- -D warnings

typecheck: ## TypeScript type-check
	pnpm typecheck

test-unit: ## No-infra tests (Rust + TS)
	cargo test --workspace
	pnpm test

test-integration: wasm ## Integration tests: WASM core in Node
	pnpm -r --if-present test:int

test-e2e: wasm ## Headless Chromium: live clipper + browser/Node parity (needs: pnpm --filter @rig/web exec playwright install chromium)
	pnpm --filter @rig/web test:e2e

test-compose: ## Boot the real docker compose stack and check auth, loopback binding and the UI
	scripts/compose-smoke.sh

up: ## Start the daemon and UI with docker compose (rig files in ./rig)
	mkdir -p rig
	RIG_UID=$$(id -u) RIG_GID=$$(id -g) docker compose up --build

wasm: ## Build the DSP core to WASM
	cargo build -p rig-core --target wasm32-unknown-unknown --release

hooks: ## Install the pre-push hook for this clone
	git config core.hooksPath .githooks
