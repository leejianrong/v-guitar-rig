# v-guitar-rig

A virtual guitar rig for the web: plug in your guitar, play through pedals and amp sims, see the signal pass through each effect, and describe a tone to your own LLM through MCP or CLI to build it.

Early planning stage. Start with [docs/PLAN.md](docs/PLAN.md); the build order is in [docs/SLICES.md](docs/SLICES.md).

```bash
make install   # deps
make hooks     # pre-push gate
make check     # lint + types + unit tests
```

Licensed under Apache-2.0.
