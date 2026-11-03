# ADR-0002: A local daemon owns a file-based rig directory; the web is a later registry

- Status: Accepted
- Date: 2026-11-03
- Deciders: Jian

## Context

M1 is a personal proof of concept deployed with docker compose. Later the user wants a public site where anyone can use it, shaped like Docker: a local daemon/engine plus an online shared repository and playground. Both a human (UI) and an LLM agent (MCP/CLI) edit the same rig.

## Decision

- A `rig` daemon (Node, runs in compose) is the only writer. It serves the UI, the HTTP/WebSocket API, offline render, and the MCP server (stdio, launched by the LLM client, talking to the daemon).
- State is plain files in a rig directory: module sources, board JSON, IR wavs, NAM captures. No database. Files are git-diffable and portable, so a future registry is "push/pull of these files".
- Every board has a `rev`. Writes carry `expectedRev`; a stale write is rejected with the current state, never silently lost. Live param changes are smoothed; module hot-swaps are crossfaded (~20 ms).
- The daemon binds 127.0.0.1 and requires a per-session token. Compose publishes the port to localhost only.

## Alternatives considered

| Option | Why not |
|--------|---------|
| Hosted multi-user app first | Doubles scope (auth, tenancy, abuse of generated code) before the core is proven |
| Database (SQLite/Postgres) | Hides the rig from the user and from git; no gain at this size |
| Browser-only with IndexedDB | The agent cannot reach it; breaks MCP/CLI |

## Consequences

Buys: user-visible, diffable state; one write path for UI, CLI and MCP; registry-ready formats. Costs: a long-running daemon and token plumbing; hosting later needs an auth and sandboxing story that this ADR deliberately does not solve.
