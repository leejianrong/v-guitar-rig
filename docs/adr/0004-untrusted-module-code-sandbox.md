# ADR-0004: Generated module code is untrusted and runs only in sandboxed scopes

- Status: Accepted
- Date: 2026-11-03
- Deciders: Jian

## Context

Behavioral modules are written by an LLM from user prompts and executed on the user's machine, and later possibly on a public service. A bad module can hang the audio thread, emit NaN or runaway gain (hearing risk), or try to reach the filesystem or network.

## Decision

- Browser: module code runs only inside the AudioWorklet global scope, which has no DOM and no network. It is a pure function of buffers and params. The page fetches a stored module's source from the daemon but never runs it, because the page holds the daemon token: the worklet compiles it (`new Function`, no `Realm`; the page sets no CSP, and the browser test shows this works), and the page keeps only its metadata. For that reason the inspector's measured curves exist for built-in pedals only.
- Daemon offline render and the gate: modules are compiled and run in a separate Node process started with `--permission` (no file writes, reads only of the sandbox script and the WASM core, no child processes, no workers), with an empty environment and a wall-clock limit after which the daemon kills it. A `worker_threads` worker was the first plan, but the permission model is per process, not per worker.
- Inside that process the source runs in a bare `node:vm` realm: no `process`, `require`, `fetch` or dynamic `import()`. The realm makes its own buffers and the host copies data in and out, because any host object handed in is a route back to the host's globals. **Node's permission model does not restrict the network**, so this realm, not the permission flags, is what keeps module code off the network; `vm` is not a hardened security boundary.
- Every module passes a gate before activation: compiles, declares a valid param schema, survives a stability test (impulse, noise, full-scale square, DC) with no NaN/Inf and bounded output, and stays under a per-block CPU budget.
- At runtime a module that throws, emits NaN, or exceeds budget is auto-bypassed; the board keeps playing and the error is reported to UI and agent (exit code 4 in CLI).
- A master limiter is always on and not configurable by modules.

## Alternatives considered

| Option | Why not |
|--------|---------|
| Trust generated code | The user's LLM is not the project's code; a single bad loop kills audio or worse |
| WASM-only modules | Raises LLM authoring cost; sandboxing benefit mostly already provided by worklet scope |
| Process-level containers per render | Heavy for an interactive loop; revisit if hosted |

## Consequences

Buys: safe iteration loop, hearing protection, a clear contract for the agent. Costs: the CPU budget cannot be enforced inside a worklet exactly (detected by overrun, not preempted), so a tight infinite loop can still stall audio until the module is removed; hosted use will need stronger isolation (a container or microVM without network, since a `vm` escape would find the network open).
