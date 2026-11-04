import { defineConfig } from "vitest/config";

// One file at a time: the sandbox tests spawn processes and render for seconds, and a module render
// that shares the CPU with them can pass the sandbox's 20 s limit (seen as a missing `descriptors`).
export default defineConfig({
  test: { include: ["src/**/*.int.test.ts"], testTimeout: 60_000, fileParallelism: false },
});
