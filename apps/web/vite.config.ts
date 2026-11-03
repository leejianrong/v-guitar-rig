import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // the WASM core is built by `make wasm` into the repo-level target dir
  server: { fs: { allow: ["../.."] }, port: 5173, strictPort: false, host: "127.0.0.1" },
  build: { target: "es2023" },
});
