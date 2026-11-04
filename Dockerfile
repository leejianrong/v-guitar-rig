# syntax=docker/dockerfile:1
FROM rust:1-slim AS wasm
WORKDIR /src
RUN rustup target add wasm32-unknown-unknown
COPY Cargo.toml Cargo.lock ./
COPY crates crates
RUN cargo build -p rig-core --target wasm32-unknown-unknown --release

FROM node:24-slim AS build
RUN corepack enable
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages packages
COPY apps apps
RUN pnpm install --frozen-lockfile
COPY --from=wasm /src/target/wasm32-unknown-unknown/release/rig_core.wasm target/wasm32-unknown-unknown/release/rig_core.wasm
RUN pnpm --filter @rig/web build && pnpm --filter @rig/daemon build

FROM node:24-slim
WORKDIR /app
COPY --from=build /src/packages/daemon/dist/rig.mjs ./rig.mjs
COPY --from=build /src/packages/daemon/dist/sandbox.mjs ./sandbox.mjs
COPY --from=build /src/apps/web/dist ./web
COPY --from=wasm /src/target/wasm32-unknown-unknown/release/rig_core.wasm ./rig_core.wasm
# Inside the container the daemon must listen on all interfaces; compose publishes it on loopback only.
ENV RIG_WASM=/app/rig_core.wasm RIG_HOST=0.0.0.0 RIG_PORT=7878 RIG_DIR=/rig
USER node
EXPOSE 7878
CMD ["node", "rig.mjs", "serve", "--web-dir", "/app/web"]
