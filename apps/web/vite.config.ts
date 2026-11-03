import { defineConfig } from "vite";

export default defineConfig({
  // the WASM core is built by `make wasm` into the repo-level target dir
  server: { fs: { allow: ["../.."] }, port: 5173, strictPort: false, host: "127.0.0.1" },
  build: { target: "es2023" },
});
