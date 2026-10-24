# Contributing

Use Node.js 22.12+ and npm. Run `npm ci`, `npm test`, and `npm run build` before submitting a change. `npm run dev` launches the desktop app; `npm run dev:web` opens the demo-only UI on localhost.

Keep SSH and deployment logic inside `packages/core`, shared IPC types inside `packages/shared`, and React inside `apps/desktop`. Renderer code must not access the shell or filesystem directly. Do not add real infrastructure, credentials or logs to fixtures.

Test remote mutations only on disposable fixtures. Preserve existing Compose configuration and persistent data. Include regression coverage for failed releases, unsafe paths, stale configuration and interrupted tasks when changing deployment behavior.

Discuss new deployment backends before building abstractions. Docker Compose is the only supported backend in this alpha.
