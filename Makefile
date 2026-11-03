.DEFAULT_GOAL := help
.PHONY: help install check lint typecheck test test-unit test-integration test-e2e wasm hooks

help: ## List targets
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-18s %s\n", $$1, $$2}'

install: ## Install JS deps (frozen) and the pinned Rust toolchain
	pnpm install --frozen-lockfile
	rustup show active-toolchain >/dev/null

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

test-integration: wasm ## Integration tests: WASM core in Node (daemon/parity tests join in V2)
	pnpm -r --if-present test:int

test-e2e: wasm ## Headless Chromium against a test-tone DI (needs: pnpm exec playwright install chromium)
	pnpm --filter @rig/web test:e2e

wasm: ## Build the DSP core to WASM
	cargo build -p rig-core --target wasm32-unknown-unknown --release

hooks: ## Install the pre-push hook for this clone
	git config core.hooksPath .githooks
