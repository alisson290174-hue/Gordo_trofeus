<div align="center">

<img src="./resources/icon.png" width="144"/>

  <h1 align="center">Balói Launcher</h1>

  <p align="center">
    <strong>A personal fork of <a href="https://github.com/hydralauncher/hydra">Hydra Launcher</a>, pointed at a self-hosted backend instead of the official one. Same core app (Electron/React/TypeScript, Rust + libtorrent for downloads), no subscription, invite-only accounts.</strong>
  </p>

</div>

## What this fork is

Hydra Launcher is an open-source gaming platform for managing a game library, browsing a download catalogue, and tracking achievements. This fork replaces the official Hydra backend with an independent one (`server/`, a small Fastify + SQLite service meant to be self-hosted) so a small group of friends can run the app without depending on the upstream service, its subscription tier, or its infrastructure.

Everything the client does — auth, profile, catalogue/download sources, synced library, achievements, friends, souvenirs — talks to whatever backend `MAIN_VITE_API_URL`/`MAIN_VITE_AUTH_URL` point at, configured per-deployment via `.env`. No server address, credentials, or invite list are committed to this repo.

Not included: real cloud-save sync and realtime (WebSocket) features — the client already degrades to polling/local-only when these aren't available, so nothing crashes, they're just not implemented server-side. Big Picture mode is present but not part of the current redesign work.

## Repository layout

- `src/` — the Electron app (main, preload, renderer), unchanged in structure from upstream Hydra
- `server/` — the independent backend for this fork (Fastify, TypeScript, `node:sqlite`), a separate project not bundled into the Electron build
- `hydra-native/` — the Rust native addon wrapping libtorrent for the download engine
- `scripts/generate-app-icon.cjs` — regenerates the Windows `.ico`, Linux icon set, and runtime PNGs from `src/renderer/src/assets/icons/app-icon-refresh.svg`

## Build from source

### Client (Electron app)

- Node.js + Yarn
- Rust toolchain (for `hydra-native`)
- Git and a C++ toolchain (Visual Studio C++ Build Tools on Windows, GCC/Clang on Linux, Xcode command-line tools on macOS). The native build obtains CMake and CTest automatically through vcpkg.

```
yarn install
yarn dev        # development
yarn build:win  # packaged Windows installer + portable exe
```

`postinstall` builds the Rust native addon automatically (`hydra-native/hydra-native.node`). Packaged and development torrenting both go through this native addon — no Python dependency.

Create a `.env` in the repo root pointing at your own backend deployment:

```
MAIN_VITE_API_URL=https://your-server-domain
MAIN_VITE_AUTH_URL=https://your-server-domain
```

### Server (backend)

```
cd server
yarn install
yarn dev     # tsx watch, local development
yarn build   # compiles to dist/
```

Requires a Steam Web API key (free, `https://steamcommunity.com/dev/apikey`) and an allowlist of Steam IDs permitted to log in — see `server/.env.example`.

## License

Licensed under the [MIT License](LICENSE), same as upstream Hydra Launcher.
