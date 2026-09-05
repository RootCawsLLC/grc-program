# syntax=docker/dockerfile:1
#
# Build context is the grc-program repo ROOT (so both the tool at / and the web
# app at /web are available). Referenced from CodeBuild as:
#   docker build -f web/Dockerfile -t <repo>:<tag> .
#
# Base image MUST be the ECR public mirror, not Docker Hub: CodeBuild pulls from
# Docker Hub hit a 429 rate limit. Both stages use it.

# ---- build: install the tool's deps, then build the web app ----
FROM public.ecr.aws/docker/library/node:22-bookworm-slim AS build
WORKDIR /repo
# python3/make/g++ are a safety net only. grc-program's warehouse uses
# @duckdb/node-api (DuckDB Neo), which ships a PREBUILT native binding as a
# plain npm package (@duckdb/node-bindings-linux-x64) — there is no node-gyp
# build step, so `npm ci --ignore-scripts` installs the binding as files and it
# loads at runtime without compilation. The toolchain is kept in case a future
# transitive dep needs to compile a native addon from source.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*

# The tool first — its src/ and data dirs are what the web app's child process
# runs against, with cwd set to /repo. No build step: the tool is pure ESM.
# --ignore-scripts skips the `prepare` hook (scripts/setup-git.mjs), which is a
# git-identity guard irrelevant outside a checkout; the prebuilt duckdb binding
# still installs because it carries no install script.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Everything runPipeline / grc health / grc gap / grc emit read at runtime, all
# relative to /repo (the child's cwd): the control inventory, the dbt-style
# models, the stamped landing fixtures, scenarios, exceptions, the requirement
# index, extracted findings, the JSON schemas and the source.
COPY src ./src
COPY controls ./controls
COPY models ./models
COPY fixtures ./fixtures
COPY scenarios ./scenarios
COPY exceptions ./exceptions
COPY reference ./reference
COPY intake ./intake
COPY schemas ./schemas
# scripts/ must be present before the web npm ci: installing the file:.. tool
# dependency re-runs the tool's `prepare` hook (scripts/setup-git.mjs), which
# --ignore-scripts does NOT suppress for a linked dep. The hook exits 0 cleanly
# outside a git checkout, so it just needs to exist.
COPY scripts ./scripts

# The web app. Install with the tool already present so the file:.. dependency
# resolves to /repo, then build.
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci --ignore-scripts
COPY web ./web
RUN cd web && npm run build

# ---- runner: run `next start` with the full tree in place ----
FROM public.ecr.aws/docker/library/node:22-bookworm-slim AS runner
WORKDIR /repo
ENV NODE_ENV=production
ENV PORT=3240
# The child process runs the tool with cwd set here, so all of the tool's
# CWD-relative data paths (controls/, models/, fixtures/landing/, …) resolve.
ENV GRC_ROOT=/repo
# No build toolchain here: the prebuilt duckdb binding only needs libstdc++
# (already present in the base image) to load. The runtime compiles nothing and
# contacts no real system — it only spawns node to open an in-memory DuckDB
# warehouse over the bundled synthetic fixtures.

# Bring the whole built tree (tool src + node_modules incl. the duckdb binding,
# web .next + node_modules, and every data dir). The web/node_modules/grc-program
# symlink points at /repo, which exists at the same path here, so it resolves.
COPY --from=build /repo /repo

WORKDIR /repo/web
EXPOSE 3240
CMD ["npx", "next", "start", "-p", "3240", "-H", "0.0.0.0"]
